const { getStockByWarehouse } = require('../services/stockService');

async function getStockByWarehouseCtrl(req, res, next) {
  try {
    const { sku, warehouseCode } = req.query;  // 👈 recibe ambos
    const result = await getStockByWarehouse({ sku, warehouseCode });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

module.exports = { getStockByWarehouseCtrl };
