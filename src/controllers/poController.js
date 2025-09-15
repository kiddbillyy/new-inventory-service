const { upsertPO } = require('../services/poService');
const {
  listOpenPOLinesDB,
  getPOByDocEntryDB,
  getPOByDocNumDB
} = require('../models/poModel');

async function upsertPOCtrl(req, res, next) {
  try {
    const { header, lines } = req.body || {};
    if (!header || !Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'header + lines requeridos' });
    }
    await upsertPO(header, lines);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function listOpenPOLinesCtrl(req, res, next) {
  try {
    const q = {
      poDocEntry: req.query.poDocEntry ? parseInt(req.query.poDocEntry, 10) : null,
      docNum:     req.query.docNum     ? parseInt(req.query.docNum, 10)     : null,  // 👈
      series:     req.query.series     ? parseInt(req.query.series, 10)     : null,  // 👈
      sku: req.query.sku || null,
      wh: req.query.wh || null,
      vendorCode: req.query.vendorCode || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      page: parseInt(req.query.page || '1', 10),
      pageSize: Math.min(parseInt(req.query.pageSize || '50', 10), 500)
    };
    const data = await listOpenPOLinesDB(q);
    res.json(data);
  } catch (err) { next(err); }
}


async function getPOCtrl(req, res, next) {
  try {
    const docEntry = parseInt(req.params.docEntry, 10);
    if (Number.isNaN(docEntry)) return res.status(400).json({ error: 'docEntry inválido' });
    const data = await getPOByDocEntryDB(docEntry);
    if (!data.header) return res.status(404).json({ error: 'OC no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
}

async function getPOByDocNumCtrl(req, res, next) {
  try {
    const docNum = parseInt(req.params.docNum, 10);
    if (Number.isNaN(docNum)) return res.status(400).json({ error: 'docNum inválido' });
    const series = req.query.series ? parseInt(req.query.series, 10) : null;
    const data = await getPOByDocNumDB(docNum, series);
    if (!data.header) return res.status(404).json({ error: 'OC no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
}

module.exports = { upsertPOCtrl , listOpenPOLinesCtrl, getPOCtrl,getPOByDocNumCtrl };
