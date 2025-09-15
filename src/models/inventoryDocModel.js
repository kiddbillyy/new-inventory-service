// src/models/inventoryDocModel.js
const { getPool, sql } = require('../config/db');

function normType(t) {
  return String(t || '').toUpperCase().trim();
}

async function createInventoryDocDB(header, lines, enqueue = true) {
  const pool = await getPool();

  // Acepta header.docType o header.type
  const docType = normType(header?.docType ?? header?.type);
  if (!docType) throw new Error('header.docType (o header.type) requerido');

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('lines[] requerido');
  }

  const tvp = new sql.Table('dbo.InventoryDocumentLineType');
tvp.columns.add('itemSku', sql.NVarChar(50));
tvp.columns.add('fromWarehouseCode', sql.NVarChar(20));
tvp.columns.add('toWarehouseCode', sql.NVarChar(20));
tvp.columns.add('quantity', sql.Decimal(18, 3));
tvp.columns.add('BaseEntry', sql.Int);   // 👈 nuevo
tvp.columns.add('BaseLine', sql.Int);    // 👈 nuevo

  for (const l of lines) {
  tvp.rows.add(
    l.itemSku,
    l.fromWh ?? null,
    l.toWh ?? null,
    l.quantity,
    l.BaseEntry ?? null, // 👈 nuevo
    l.BaseLine ?? null   // 👈 nuevo
  );
}


  const result = await pool.request()
    .input('docType',     sql.NVarChar(20),  docType)
    .input('fromWh',      sql.NVarChar(20),  header.fromWh ?? null)
    .input('toWh',        sql.NVarChar(20),  header.toWh ?? null)
    .input('postingDate', sql.DateTime2,     header.postingDate || null)
    .input('reference',   sql.NVarChar(200), header.reference ?? null)
    .input('metaJson',    sql.NVarChar(sql.MAX),
                         header.metaJson ? (typeof header.metaJson === 'string' ? header.metaJson : JSON.stringify(header.metaJson)) : null)
    .input('externalRef', sql.NVarChar(100), header.externalRef ?? null)
    .input('lines',       tvp)
    .input('enqueue',     sql.Bit,           enqueue ? 1 : 0)
    .execute('dbo.apply_inventory_document');

  const row = result.recordset?.[0] || {};
  return {
    documentId: row.documentId ?? null,
    status: row.status ?? 'APPLIED',
    movementIdsJson: row.movementIdsJson || '[]'
  };
}

async function getInventoryDocDB(id) {
  const pool = await getPool();
  const h = await pool.request().input('id', sql.Int, id)
    .query('SELECT * FROM dbo.InventoryDocuments WHERE id=@id');
  const l = await pool.request().input('id', sql.Int, id)
    .query('SELECT * FROM dbo.InventoryDocumentLines WHERE documentId=@id ORDER BY id');
  return { header: h.recordset?.[0] || null, lines: l.recordset || [] };
}

async function listInventoryDocsDB(q = {}) {
  const pool = await getPool();
  const req = pool.request()
    .input('docType',  sql.NVarChar(20), q.docType || null)
    .input('status',   sql.NVarChar(20), q.status  || null)
    .input('dateFrom', sql.DateTime2,    q.dateFrom || null)
    .input('dateTo',   sql.DateTime2,    q.dateTo   || null)
    .input('page',     sql.Int,          q.page || 1)
    .input('pageSize', sql.Int,          q.pageSize || 50);

  const sqlText = `
    SET NOCOUNT ON;
    IF OBJECT_ID('tempdb..#d') IS NOT NULL DROP TABLE #d;

    SELECT *
    INTO #d
    FROM dbo.InventoryDocuments
    WHERE (@docType IS NULL OR docType=@docType)
      AND (@status  IS NULL OR [status]=@status)
      AND (@dateFrom IS NULL OR postingDate >= @dateFrom)
      AND (@dateTo   IS NULL OR postingDate <  @dateTo);

    SELECT id, docType, fromWarehouseCode AS fromWh, toWarehouseCode AS toWh,
           postingDate, [status], [reference], sapDocEntry, sapDocNum, createdAt, updatedAt
    FROM #d
    ORDER BY postingDate DESC, id DESC
    OFFSET (@page-1)*@pageSize ROWS FETCH NEXT @pageSize ROWS ONLY;

    SELECT COUNT(1) AS Total FROM #d;
  `;
  const rs = await req.query(sqlText);
  return { rows: rs.recordsets?.[0] || [], total: rs.recordsets?.[1]?.[0]?.Total ?? 0 };
}

module.exports = { createInventoryDocDB, getInventoryDocDB, listInventoryDocsDB };
