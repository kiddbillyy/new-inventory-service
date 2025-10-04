const { getPool, sql } = require('../config/db');

async function getStockByWarehouseDB({ sku, warehouseCode }) {
  const pool = await getPool();
  let q = 'SELECT * FROM dbo.ItemWarehouseStock';
  const req = pool.request();

  const filters = [];
  if (sku) {
    filters.push('itemSku=@sku');
    req.input('sku', sql.NVarChar(50), sku);
  }
  if (warehouseCode) {
    filters.push('warehouseCode=@warehouseCode');
    req.input('warehouseCode', sql.NVarChar(20), warehouseCode);
  }

  if (filters.length > 0) {
    q += ' WHERE ' + filters.join(' AND ');
  }

  q += ' ORDER BY itemSku, warehouseCode';

  const { recordset } = await req.query(q);
  return recordset;
}

module.exports = { getStockByWarehouseDB };
