const { getStockByWarehouse } = require('../services/stockService');
async function getStockByWarehouseCtrl(req, res, next) {
  try { res.json(await getStockByWarehouse({ sku: req.query.sku })); }
  catch (err) { next(err); }
}
module.exports = { getStockByWarehouseCtrl };
