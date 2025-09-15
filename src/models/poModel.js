const { getPool, sql } = require('../config/db');

async function upsertPurchaseOrderDB(header, lines) {
  const pool = await getPool();

  const tvp = new sql.Table('dbo.PurchaseOrderLineType');
  tvp.columns.add('poDocEntry', sql.Int);
  tvp.columns.add('lineNum', sql.Int);
  tvp.columns.add('itemSku', sql.NVarChar(50));
  tvp.columns.add('warehouseCode', sql.NVarChar(20));
  tvp.columns.add('orderedQty', sql.Decimal(18,3));
  tvp.columns.add('openQty', sql.Decimal(18,3));
  tvp.columns.add('price', sql.Decimal(19,6));
  tvp.columns.add('currency', sql.NVarChar(3));
  tvp.columns.add('taxCode', sql.NVarChar(8));
  tvp.columns.add('uomCode', sql.NVarChar(20));
  tvp.columns.add('lineStatus', sql.NChar(1));
  for (const l of lines) {
    tvp.rows.add(l.poDocEntry, l.lineNum, l.itemSku, l.warehouseCode ?? null,
      l.orderedQty, l.openQty, l.price ?? null, l.currency ?? null, l.taxCode ?? null, l.uomCode ?? null, l.lineStatus);
  }

  await pool.request()
    .input('poDocEntry', sql.Int, header.poDocEntry)
    .input('docNum', sql.Int, header.docNum ?? null)
    .input('series', sql.Int, header.series ?? null)
    .input('vendorCode', sql.NVarChar(20), header.vendorCode)
    .input('vendorName', sql.NVarChar(100), header.vendorName ?? null)
    .input('docDate', sql.DateTime2, header.docDate)
    .input('docDueDate', sql.DateTime2, header.docDueDate ?? null)
    .input('docStatus', sql.NChar(1), header.docStatus)
    .input('cancelled', sql.Bit, !!header.cancelled)
    .input('currency', sql.NVarChar(3), header.currency ?? null)
    .input('docTotal', sql.Decimal(19,6), header.docTotal ?? null)
    .input('comments', sql.NVarChar(254), header.comments ?? null)
    .input('lines', tvp)
    .execute('dbo.upsert_purchase_order');
}
async function listOpenPOLinesDB(q) {
  const pool = await getPool();
  const req = pool.request()
    .input('poDocEntry', sql.Int, q.poDocEntry ?? null)
    .input('docNum', sql.Int, q.docNum ?? null)          
    .input('series', sql.Int, q.series ?? null)   
    .input('sku', sql.NVarChar(50), q.sku ?? null)
    .input('wh', sql.NVarChar(20), q.wh ?? null)
    .input('vendorCode', sql.NVarChar(20), q.vendorCode ?? null)
    .input('dateFrom', sql.DateTime2, q.dateFrom ?? null)
    .input('dateTo', sql.DateTime2, q.dateTo ?? null)
    .input('page', sql.Int, q.page || 1)
    .input('pageSize', sql.Int, q.pageSize || 50);

  const qry = `
    SET NOCOUNT ON;
    IF OBJECT_ID('tempdb..#base') IS NOT NULL DROP TABLE #base;

    SELECT *
    INTO #base
    FROM dbo.vw_PurchaseOrderOpenLines
    WHERE ( @poDocEntry IS NULL OR poDocEntry = @poDocEntry )
      AND ( @docNum    IS NULL OR docNum     = @docNum )          
      AND ( @series    IS NULL OR series     = @series )  
      AND ( @sku IS NULL OR LEN(LTRIM(RTRIM(@sku))) = 0 OR itemSku = @sku )
      AND ( @wh  IS NULL OR LEN(LTRIM(RTRIM(@wh ))) = 0 OR warehouseCode = @wh )
      AND ( @vendorCode IS NULL OR LEN(LTRIM(RTRIM(@vendorCode))) = 0 OR vendorCode = @vendorCode )
      AND ( @dateFrom IS NULL OR docDate >= @dateFrom )
      AND ( @dateTo   IS NULL OR docDate <  @dateTo );

    SELECT *
    FROM #base
    ORDER BY docDate DESC, poDocEntry, lineNum
    OFFSET (@page - 1) * @pageSize ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(1) AS Total FROM #base;
  `;

  const result = await req.query(qry);
  return {
    rows: result.recordsets?.[0] || [],
    total: result.recordsets?.[1]?.[0]?.Total ?? 0
  };
}

async function getPOByDocEntryDB(docEntry) {
  const pool = await getPool();
  const h = await pool.request().input('doc', sql.Int, docEntry)
    .query(`SELECT * FROM dbo.PurchaseOrders WHERE poDocEntry=@doc`);
  const l = await pool.request().input('doc', sql.Int, docEntry)
    .query(`SELECT * FROM dbo.PurchaseOrderLines WHERE poDocEntry=@doc ORDER BY lineNum`);
  return { header: h.recordset?.[0] || null, lines: l.recordset || [] };
}

async function getPOByDocNumDB(docNum, series = null) {
  const pool = await getPool();
  const req = pool.request().input('docNum', sql.Int, docNum);
  let hdrSql = `SELECT * FROM dbo.PurchaseOrders WHERE docNum=@docNum`;
  if (series !== null) { hdrSql += ` AND series=@series`; req.input('series', sql.Int, series); }

  const hRS = await req.query(hdrSql);
  const header = hRS.recordset?.[0] || null;
  if (!header) return { header: null, lines: [] };

  const lRS = await pool.request()
    .input('poDocEntry', sql.Int, header.poDocEntry)
    .query(`SELECT * FROM dbo.PurchaseOrderLines WHERE poDocEntry=@poDocEntry ORDER BY lineNum`);
  return { header, lines: lRS.recordset || [] };
}

module.exports = { listOpenPOLinesDB, getPOByDocEntryDB, upsertPurchaseOrderDB,getPOByDocNumDB };

