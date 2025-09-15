const { Kafka, logLevel } = require('kafkajs');
const { kafka: cfg } = require('./env');

const kafka = new Kafka({ clientId: cfg.clientId, brokers: cfg.brokers, logLevel: logLevel.NOTHING });
async function createConsumer() { const c = kafka.consumer({ groupId: cfg.groupId }); await c.connect(); return c; }
async function createProducer() { const p = kafka.producer(); await p.connect(); return p; }

module.exports = { createConsumer, createProducer, cfg };
