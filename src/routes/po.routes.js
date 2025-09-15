const express = require('express');
const { upsertPOCtrl,listOpenPOLinesCtrl, getPOCtrl,getPOByDocNumCtrl } = require('../controllers/poController');
const { syncOpenPOsFromDB } = require('../workers/sapPOFetcherDirect');
const r = express.Router();



r.post('/po/upsert', upsertPOCtrl);
r.get('/po/open-lines', listOpenPOLinesCtrl);  // ✅ nuevas
r.get('/po/:docEntry', getPOCtrl);            // ✅ nuevas
r.get('/po/by-docnum/:docNum', getPOByDocNumCtrl);

r.post('/sap/po/sync-now-db', async (req, res, next) => {
  try { res.json(await syncOpenPOsFromDB()); }
  catch (e) { next(e); }
});


module.exports = r;
