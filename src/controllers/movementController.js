const { applyMovement } = require('../services/movementService');

async function postMovement(req, res, next) {
  try {
    const body = req.body || {};
    const result = await applyMovement(body, { enqueue: body.enqueue !== false });
    res.status(201).json({ ok: true, ...result });
  } catch (err) { next(err); }
}

const { listMovementsDB } = require('../models/movementModel');
async function getMovements(req, res, next) {
  try {
    const data = await listMovementsDB({
      sku: req.query.sku, type: req.query.type, wh: req.query.wh, status: req.query.status,
      dateFrom: req.query.dateFrom, dateTo: req.query.dateTo,
      page: parseInt(req.query.page || '1', 10), pageSize: Math.min(parseInt(req.query.pageSize || '50', 10), 500)
    });
    res.json(data);
  } catch (err) { next(err); }
}

module.exports = { postMovement, getMovements };
