// src/routes/integration.routes.js
const express = require('express');
const { getPool, sql } = require('../config/db');
const { dispatchBatch, buildOPDN, buildOIGN, buildOIGE, buildOWTR } = require('../workers/sapWorker');

const r = express.Router();

// ---- helper para cargar doc + líneas
async function loadDoc(docId) {
  const pool = await getPool();
  const h = await pool.request().input('id', sql.Int, docId)
    .query('SELECT * FROM dbo.InventoryDocuments WHERE id=@id');
  const l = await pool.request().input('id', sql.Int, docId)
    .query('SELECT * FROM dbo.InventoryDocumentLines WHERE documentId=@id ORDER BY id');
  const header = h.recordset?.[0] || null;
  return { header, lines: l.recordset || [] };
}

// ---- procesa N pendientes (EP/TT/EM/SM)
r.post('/integration/dispatch', async (req, res, next) => {
  try {
    const batch = Number(req.body?.batch || 10);
    const out = await dispatchBatch(batch);
    return res.json(out);
  } catch (e) { next(e); }
});

// ---- compat: un disparo (no garantiza EP primero, pero respeta el más antiguo)
r.post('/integration/ep/dispatch', async (req, res, next) => {
  try {
    const out = await dispatchBatch(1);
    return res.json(out);
  } catch (e) { next(e); }
});

// ---- preview del payload que se ENVIARÍA a SAP (no postea)
r.get('/integration/sap-payload/:docId', async (req, res, next) => {
  try {
    const id = Number(req.params.docId);
    const { header, lines } = await loadDoc(id);
    if (!header) return res.status(404).json({ error: 'Documento no existe' });

    let path, body;
    switch (header.docType) {
      case 'EP':
        path = '/PurchaseDeliveryNotes';
        body = buildOPDN(header, lines);
        break;
      case 'EM':
        path = '/InventoryGenEntries';
        body = buildOIGN(header, lines);
        break;
      case 'SM':
        path = '/InventoryGenExits';
        body = buildOIGE(header, lines);
        break;
      case 'TT':
        path = '/StockTransfers';
        body = buildOWTR(header, lines);
        break;
      default:
        return res.status(400).json({ error: `Tipo no soportado: ${header.docType}` });
    }
    return res.json({ path, body });
  } catch (e) { next(e); }
});

module.exports = r;
