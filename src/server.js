// server.js
const express = require('express');
const cors = require('cors');
const { port, serviceName } = require('./config/env');

// Rutas
const health = require('./routes/health.routes');
const movements = require('./routes/movements.routes');
const stock = require('./routes/stock.routes');
const po = require('./routes/po.routes');
const invDocsRoutes = require('./routes/inventoryDocs.routes');
const integrationRoutes = require('./routes/integration.routes');

// Kafka consumer (eventos de SAP)
const { startPoEventsConsumer } = require('./kafka/poEventsConsumer'); // 👈 ruta al consumer

const app = express();
app.use(express.json({ limit: '1mb' }));
// 🔓 CORS: permitir todos los orígenes (sin cookies)
app.use(cors());            // Access-Control-Allow-Origin: *
app.options('*', cors());   // Maneja preflight en cualquier ruta
app.use('/api', health, movements, stock, po, invDocsRoutes, integrationRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

// Boot
const server = app.listen(port, () =>
  console.log(`🚀 ${serviceName} listening on :${port}`)
);

// ⏱️ Cargar cron jobs (se agendan al requerir el archivo)
if (process.env.ENABLE_CRON !== '0') {
  require('./workers/cronRunner');
  console.log('⏱️ cron runners loaded');
}

// 📥 Kafka consumer (opcional por env)
let kafkaConsumer;
(async () => {
  if (process.env.KAFKA_ENABLE === '1') {
    try {
      kafkaConsumer = await startPoEventsConsumer();
      console.log('📥 Kafka consumer started');
    } catch (e) {
      console.error('[Kafka] failed to start:', e.message || e);
    }
  }
})();

// 👋 apagado limpio
async function shutdown(signal) {
  console.log(`\n${signal} received, shutting down...`);
  try {
    if (kafkaConsumer) await kafkaConsumer.disconnect();
  } catch (e) {
    console.error('Error on consumer disconnect:', e.message || e);
  } finally {
    server.close(() => process.exit(0));
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
