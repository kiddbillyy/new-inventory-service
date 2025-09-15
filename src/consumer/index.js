const { createConsumer, cfg } = require('../config/kafka');
const { getPool, sql } = require('../config/db');
const { applyMovement } = require('../services/movementService');

(async () => {
  const consumer = await createConsumer();
  await consumer.subscribe({ topic: cfg.topicIn, fromBeginning: false });
  console.log('[consumer] subscribed to', cfg.topicIn);

  async function alreadyProcessed(eventId) {
    const pool = await getPool();
    const { recordset } = await pool.request()
      .input('eventId', sql.NVarChar(100), eventId)
      .query('SELECT 1 AS x FROM dbo.ProcessedEvents WHERE eventId=@eventId');
    return recordset.length > 0;
  }
  async function markProcessed(eventId, topic, partition, offset) {
    const pool = await getPool();
    await pool.request()
      .input('eventId', sql.NVarChar(100), eventId)
      .input('topic', sql.NVarChar(200), topic)
      .input('partitionId', sql.Int, partition)
      .input('offsetValue', sql.BigInt, Number(offset))
      .query(`INSERT INTO dbo.ProcessedEvents(eventId, topic, partitionId, offsetValue) VALUES (@eventId,@topic,@partitionId,@offsetValue)`);
  }

  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      try {
        const eventId = message.key?.toString() || message.headers?.eventId?.toString();
        const payload = JSON.parse(message.value.toString());

        if (!eventId) return; // descartable
        if (await alreadyProcessed(eventId)) return;

        const res = await applyMovement(payload, { enqueue: payload.enqueue !== false });
        await markProcessed(eventId, topic, partition, message.offset);
        console.log('[consumer] applied', res);
      } catch (err) {
        console.error('[consumer] error', err?.message);
      }
    }
  });
})();
