const { getPool, sql } = require('../config/db');

async function getStockByWarehouseDB({ sku }) {
  const pool = await getPool();
  let q = 'SELECT * FROM dbo.vw_StockByWarehouse';
  const req = pool.request();
  if (sku) { q += ' WHERE itemSku=@sku'; req.input('sku', sql.NVarChar(50), sku); }
  q += ' ORDER BY itemSku, warehouseCode';
  const { recordset } = await req.query(q);
  return recordset;
}

module.exports = { getStockByWarehouseDB };
