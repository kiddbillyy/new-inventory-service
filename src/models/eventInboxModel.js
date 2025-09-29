const { getPool, sql } = require('../config/db');

async function recordEvent({ source, event, idempotencyKey, payload }) {
  const pool = await getPool();
  try {
    const rs = await pool.request()
      .input('source', sql.NVarChar(100), source)
      .input('event',  sql.NVarChar(200), event)
      .input('key',    sql.NVarChar(200), idempotencyKey)
      .input('payload',sql.NVarChar(sql.MAX), payload)
      .query(`
        INSERT INTO dbo.EventInbox (source, event, idempotencyKey, payload)
        OUTPUT INSERTED.id
        VALUES (@source, @event, @key, @payload);
      `);
    return { id: rs.recordset[0].id, inserted: true };
  } catch (e) {
    // Duplicado (idempotencyKey ya existe)
    if (e.number === 2627 || /duplicate/i.test(e.message)) {
      const rs = await pool.request()
        .input('key', sql.NVarChar(200), idempotencyKey)
        .query('SELECT id, status FROM dbo.EventInbox WHERE idempotencyKey=@key;');
      return { id: rs.recordset?.[0]?.id || null, inserted: false, status: rs.recordset?.[0]?.status };
    }
    throw e;
  }
}

async function markEventDone(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.BigInt, id).query(`
    UPDATE dbo.EventInbox SET status='DONE', processedAt=SYSDATETIME() WHERE id=@id;
  `);
}

async function markEventFailed(id, errorMsg) {
  const pool = await getPool();
  await pool.request()
    .input('id',  sql.BigInt, id)
    .input('err', sql.NVarChar(4000), String(errorMsg).substring(0,4000))
    .query(`
      UPDATE dbo.EventInbox
      SET status='FAILED', errorMsg=@err, processedAt=SYSDATETIME()
      WHERE id=@id;
    `);
}

module.exports = { recordEvent, markEventDone, markEventFailed };
