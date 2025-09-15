const express = require('express');
const { getStockByWarehouseCtrl } = require('../controllers/stockController');
const r = express.Router();

r.get('/stock/by-warehouse', getStockByWarehouseCtrl);

module.exports = r;
