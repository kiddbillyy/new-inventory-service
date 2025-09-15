// src/workers/sapPOFetcherDirect.js
const { getSapPool, sql: sapSql } = require('../config/sapDb');
const { getPool, sql } = require('../config/db');
const {upsertPO}=require('../services/poService');

const LOOKBACK_DAYS = Number(process.env.SAP_PO_SYNC_LOOKBACK_DAYS || 7);
const BATCH = Number(process.env.SAP_PO_DB_BATCH || 500);
const LOG = process.env.LOG_SAP === '1';

async function getLastSyncAt() {
  const pool = await getPool();
  const rs = await pool.request()
    .input('k', sql.NVarChar(100), 'sap_po_last_sync_at_db')
    .query(`SELECT [value] FROM dbo.SyncState WHERE [key]=@k`);
  const v = rs.recordset?.[0]?.value;
  if (v) {
    const d = new Date(v);
    if (!isNaN(+d)) return d;
  }
  const d = new Date();
  d.setDate(d.getDate() - LOOKBACK_DAYS);
  d.setHours(0,0,0,0);
  return d;
}

async function setLastSyncAt(dt) {
  const pool = await getPool();
  await pool.request()
    .input('k', sql.NVarChar(100), 'sap_po_last_sync_at_db')
    .input('v', sql.NVarChar(sql.MAX), dt.toISOString())
    .query(`
      MERGE dbo.SyncState AS t
      USING (SELECT @k AS [key]) s ON t.[key]=s.[key]
      WHEN MATCHED THEN UPDATE SET [value]=@v, updatedAt=SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT([key],[value]) VALUES(@k,@v);
    `);
}

let HAS_UPDATE_TIME = null;
async function hasUpdateTimeColumn() {
  if (HAS_UPDATE_TIME !== null) return HAS_UPDATE_TIME;
  const pool = await getSapPool();
  const rs = await pool.request().query(`
    SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('OPOR') AND name = 'UpdateTime'
  `);
  HAS_UPDATE_TIME = (rs.recordset?.length || 0) > 0;
  if (LOG) console.log('[PO DB] OPOR.UpdateTime exists =', HAS_UPDATE_TIME);
  return HAS_UPDATE_TIME;
}

/** Trae headers:
 * - Si hay UpdateTime: fecha+hora (cursor -1min)
 * - Si NO hay UpdateTime: SOLO el día de hoy (en hora del servidor SQL)
 */
async function fetchHeaders(effective) {
  const pool = await getSapPool();
  const useTime = await hasUpdateTimeColumn();

  if (useTime) {
    // … (tu versión con fecha+hora; la omito por brevedad)
  } else {
    // ⬇️ Sin hora: solo “hoy” (según GETDATE() del SQL de SAP)
    const rs = await pool.request().query(`
      SELECT TOP (${BATCH})
        P.DocEntry, P.DocNum, P.Series,
        P.DocDate, P.DocDueDate,
        P.CardCode, C.CardName,
        P.DocCur AS DocCurrency, P.DocTotal, P.Comments,
        P.DocStatus, CASE WHEN P.CANCELED='Y' THEN 1 ELSE 0 END AS Canceled,
        P.UpdateDate
      FROM OPOR AS P WITH (NOLOCK)
      LEFT JOIN OCRD AS C WITH (NOLOCK) ON C.CardCode = P.CardCode
      WHERE P.DocStatus='O'
        AND P.CANCELED='N'
        AND P.UpdateDate = CONVERT(date, GETDATE())  -- ✅ solo HOY
      ORDER BY P.UpdateDate, P.DocEntry;
    `);
    return rs.recordset || [];
  }
}

async function fetchLines(docEntry) {
  const pool = await getSapPool();
  const rs = await pool.request().input('de', sapSql.Int, docEntry).query(`
    SELECT LineNum, ItemCode AS ItemCode, WhsCode AS WarehouseCode,
           Quantity, OpenQty AS OpenQuantity, Price, Currency, TaxCode, UoMCode, LineStatus
    FROM POR1 WITH (NOLOCK)
    WHERE DocEntry = @de
    ORDER BY LineNum;
  `);
  return rs.recordset || [];
}

// mapLinesToTVP, upsertPO: idénticos a tu versión

async function syncOpenPOsFromDB() {
  const started   = new Date();               // 🕒 hora real (se guarda)
  const lastSaved = await getLastSyncAt();
  const effective = new Date(lastSaved.getTime() - 60*1000);  // solape -1min

  const headers = await fetchHeaders(effective);
  let upserts = 0;
  for (const h of headers) {
    const lines = await fetchLines(h.DocEntry);
    await upsertPO(h, lines);
    upserts++;
  }

  await setLastSyncAt(started);   // ✅ guarda hora REAL de esta ejecución

  return {
    from: lastSaved.toISOString(),
    usedFrom: effective.toISOString(),  // informativo
    savedAt: started.toISOString(),
    fetched: headers.length,
    upserts
  };
}

module.exports = { syncOpenPOsFromDB };
