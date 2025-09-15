const { getPool, sql } = require('../config/db');

async function getStockByWarehouseDB({ sku }) {
  const pool = await getPool();
  let q = 'SELECT * FROM dbo.vw_StockByWarehouse';
  const req = pool.request();
  if (sku) { q += ' WHERE sku=@sku'; req.input('sku', sql.NVarChar(50), sku); }
  q += ' ORDER BY sku, warehouse';
  const { recordset } = await req.query(q);
  return recordset;
}

module.exports = { getStockByWarehouseDB };
