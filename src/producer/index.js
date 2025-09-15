const { createProducer, cfg } = require('../config/kafka');

let producer;
async function getProducer() { if (!producer) producer = await createProducer(); return producer; }

async function publishOut(eventKey, payload) {
  const p = await getProducer();
  await p.send({ topic: cfg.topicOut, messages: [{ key: String(eventKey), value: JSON.stringify(payload) }] });
}
module.exports = { publishOut };
