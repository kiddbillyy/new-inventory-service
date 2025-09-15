const { getStockByWarehouseDB } = require('../models/stockModel');
async function getStockByWarehouse(q) { return getStockByWarehouseDB(q); }
module.exports = { getStockByWarehouse };
