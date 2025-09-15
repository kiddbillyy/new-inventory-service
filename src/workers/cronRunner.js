// src/workers/cronRunner.js
const cron = require('node-cron');
const { dispatchBatch } = require('./sapWorker');
const { syncOpenPOsFromDB } = require('./sapPOFetcherDirect'); // ✅ IMPORTA

const BATCH_SIZE = Number(process.env.SAP_WORKER_BATCH || 10);

let runningDispatch = false;
let runningPO = false;

// Enviar docs de inventario a SAP: cada 1 min
cron.schedule('* * * * *', async () => {
  if (runningDispatch) return;            // ✅ evita solapes
  runningDispatch = true;
  try {
    const out = await dispatchBatch(BATCH_SIZE);
    console.log('[SAP CRON] dispatched:', JSON.stringify(out));
  } catch (e) {
    console.error('[SAP CRON] error:', e.message || e);
  } finally {
    runningDispatch = false;
  }
});

// Sync OC por DB: cada 5 min (puedes dejar 1 min si quieres, pero 5 es lo pedido)
cron.schedule('*/1 * * * *', async () => {
  if (runningPO) return;                  // ✅ evita solapes
  runningPO = true;
  try {
    const out = await syncOpenPOsFromDB();
    console.log('[PO CRON DB] synced:', JSON.stringify(out));
  } catch (e) {
    console.error('[PO CRON DB] error:', e.message || e);
  } finally {
    runningPO = false;
  }
});

console.log('⏱️ SAP integration cron on: dispatch=*1min, PO sync=*/1min');
