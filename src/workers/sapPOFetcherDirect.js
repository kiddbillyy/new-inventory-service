// src/workers/sapPOFetcherDirect.js
const { getSapPool, sql: sapSql } = require('../config/sapDb');
const { getPool, sql } = require('../config/db');
const { upsertPO } = require('../services/poService');

const LOOKBACK_DAYS = Number(process.env.SAP_PO_SYNC_LOOKBACK_DAYS || 7);
const BATCH        = Number(process.env.SAP_PO_DB_BATCH || 500);
const LOG          = process.env.LOG_SAP === '1';

const CURSOR_KEY = 'sap_po_last_cursor'; // JSON { ts }
const SAP_TIMEZONE = process.env.SAP_TIMEZONE || 'America/Santiago';
const SAP_TZ_OFFSET_MINUTES = isFinite(+process.env.SAP_TZ_OFFSET_MINUTES)
  ? +process.env.SAP_TZ_OFFSET_MINUTES : null;
const SAP_CURSOR_FROM_DB = process.env.SAP_CURSOR_FROM_DB === '1';   // usa updatedAt
const SAP_SAVE_TS_IN_DB  = process.env.SAP_SAVE_TS_IN_DB  === 'db';  // value lo escribe SQL

// ---------- Cursor (leer usando updatedAt o value.ts) ----------
async function getCursorPartsForSAP() {
  const pool = await getPool();

  if (SAP_CURSOR_FROM_DB) {
    // ⚠️ Tomamos la hora de SQL (updatedAt) y calculamos el solape -1m en SQL.
    const rs = await pool.request()
      .input('k', sql.NVarChar(100), CURSOR_KEY)
      .query(`
        SELECT
          effDate = CONVERT(date, DATEADD(minute, -1, updatedAt)),
          effTime = (DATEPART(HOUR,   DATEADD(minute,-1, updatedAt)) * 10000)
                  + (DATEPART(MINUTE, DATEADD(minute,-1, updatedAt)) * 100)
                  + (DATEPART(SECOND, DATEADD(minute,-1, updatedAt)))
        FROM dbo.SyncState
        WHERE [key]=@k
      `);

    // Si no existe, retroceder LOOKBACK_DAYS y 00:00:00
    if (!rs.recordset?.length || rs.recordset[0].effDate == null) {
      const fallback = await pool.request()
        .query(`
          SELECT effDate = CONVERT(date, DATEADD(day, -${LOOKBACK_DAYS}, SYSUTCDATETIME())),
                 effTime = 0
        `);
      const r = fallback.recordset[0];
      return { tsDate: r.effDate, tsTime: r.effTime };
    }
    const r = rs.recordset[0];
    return { tsDate: r.effDate, tsTime: r.effTime };
  }

  // Modo clásico: tomamos value.ts (UTC) y lo convertimos a zona SAP en Node.
  const { tsUtc } = await getCursorUtc();
  const effectiveUtc = new Date(tsUtc.getTime() - 60 * 1000); // solape -1m
  const { dateStr, hhmmss } = toSapLocalPartsFromUTC(effectiveUtc);
  return { tsDate: dateStr, tsTime: hhmmss };
}

async function getCursorUtc() {
  const pool = await getPool();
  const rs = await pool.request()
    .input('k', sql.NVarChar(100), CURSOR_KEY)
    .query(`SELECT [value] FROM dbo.SyncState WHERE [key]=@k`);

  let tsUtc;
  if (rs.recordset?.[0]?.value) {
    try {
      const parsed = JSON.parse(rs.recordset[0].value);
      tsUtc = parsed?.ts ? new Date(parsed.ts) : null; // ISO UTC
    } catch {}
  }
  if (!tsUtc || isNaN(+tsUtc)) {
    tsUtc = new Date();
    tsUtc.setDate(tsUtc.getDate() - LOOKBACK_DAYS);
    tsUtc.setUTCHours(0,0,0,0);
  }
  return { tsUtc };
}

async function setLastCursorNow() {
  const pool = await getPool();

  if (SAP_SAVE_TS_IN_DB) {
    // SQL genera el value con su propia hora (sin Z) y también updatedAt
    await pool.request()
      .input('k', sql.NVarChar(100), CURSOR_KEY)
      .query(`
        DECLARE @now DATETIME2 = SYSDATETIME();
        DECLARE @json NVARCHAR(MAX) = N'{"ts":"' + CONVERT(nvarchar(33), @now, 127) + N'"}';
        MERGE dbo.SyncState AS t
        USING (SELECT @k AS [key]) s ON t.[key]=s.[key]
        WHEN MATCHED THEN UPDATE SET [value]=@json, updatedAt=@now
        WHEN NOT MATCHED THEN INSERT([key],[value],[updatedAt]) VALUES(@k,@json,@now);
      `);
  } else {
    // Guardamos UTC desde Node (como antes)
    const nowUtcIso = new Date().toISOString();
    await pool.request()
      .input('k', sql.NVarChar(100), CURSOR_KEY)
      .input('v', sql.NVarChar(sql.MAX), JSON.stringify({ ts: nowUtcIso }))
      .query(`
        MERGE dbo.SyncState AS t
        USING (SELECT @k AS [key]) s ON t.[key]=s.[key]
        WHEN MATCHED THEN UPDATE SET [value]=@v, updatedAt=SYSDATETIME()
        WHEN NOT MATCHED THEN INSERT([key],[value]) VALUES(@k,@v);
      `);
  }
}

// ---------- Utils TZ ----------
function toSapLocalPartsFromUTC(utcDate) {
  if (typeof SAP_TZ_OFFSET_MINUTES === 'number') {
    const ms = utcDate.getTime() + SAP_TZ_OFFSET_MINUTES * 60000;
    const d  = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm   = String(d.getUTCMonth() + 1).padStart(2,'0');
    const dd   = String(d.getUTCDate()).padStart(2,'0');
    const hh   = String(d.getUTCHours()).padStart(2,'0');
    const mi   = String(d.getUTCMinutes()).padStart(2,'0');
    const ss   = String(d.getUTCSeconds()).padStart(2,'0');
    return { dateStr: `${yyyy}-${mm}-${dd}`, hhmmss: parseInt(`${hh}${mi}${ss}`,10) };
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: SAP_TIMEZONE,
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false,
    });
    const p = Object.fromEntries(fmt.formatToParts(utcDate).map(x => [x.type, x.value]));
    return { dateStr: `${p.year}-${p.month}-${p.day}`, hhmmss: parseInt(`${p.hour}${p.minute}${p.second}`,10) };
  } catch {
    // Fallback: usar UTC (no ideal)
    const yyyy = utcDate.getUTCFullYear();
    const mm   = String(utcDate.getUTCMonth() + 1).padStart(2,'0');
    const dd   = String(utcDate.getUTCDate()).padStart(2,'0');
    const hh   = String(utcDate.getUTCHours()).padStart(2,'0');
    const mi   = String(utcDate.getUTCMinutes()).padStart(2,'0');
    const ss   = String(utcDate.getUTCSeconds()).padStart(2,'0');
    return { dateStr: `${yyyy}-${mm}-${dd}`, hhmmss: parseInt(`${hh}${mi}${ss}`,10) };
  }
}

// ---------- Query única: creadas O actualizadas después del cursor ----------
async function fetchHeadersChangedAfter(tsDate /* DATE string yyyy-mm-dd */, tsTime /* INT hhmmss */) {
  const pool = await getSapPool();

  if (LOG) console.log('[PO] SAP cursor -> DATE:', tsDate, 'TIME:', tsTime);

  const rs = await pool.request()
    .input('tsDate', sapSql.Date, tsDate)
    .input('tsTime', sapSql.Int,  tsTime)
    .query(`
      SELECT TOP (${BATCH})
        P.DocEntry, P.DocNum, P.Series,
        P.DocDate, P.DocDueDate,
        P.CardCode, C.CardName,
        P.DocCur AS DocCurrency, P.DocTotal, P.Comments,
        P.DocStatus, CASE WHEN P.CANCELED='Y' THEN 1 ELSE 0 END AS Canceled,
        P.CreateDate, ISNULL(P.CreateTS,0) AS CreateTS,
        P.UpdateDate, ISNULL(P.UpdateTS,0) AS UpdateTS
      FROM dbo.OPOR AS P WITH (NOLOCK)
      LEFT JOIN dbo.OCRD AS C WITH (NOLOCK) ON C.CardCode = P.CardCode
      WHERE P.CANCELED='N'
        AND (
          (P.CreateDate > @tsDate)
          OR (P.CreateDate = @tsDate AND ISNULL(P.CreateTS,0) > @tsTime)
          OR (P.UpdateDate > @tsDate)
          OR (P.UpdateDate = @tsDate AND ISNULL(P.UpdateTS,0) > @tsTime)
        )
      ORDER BY
        CASE WHEN P.UpdateDate IS NOT NULL THEN 1 ELSE 2 END,
        ISNULL(P.UpdateDate, P.CreateDate),
        CASE WHEN P.UpdateDate IS NOT NULL THEN ISNULL(P.UpdateTS,0) ELSE ISNULL(P.CreateTS,0) END,
        P.DocEntry;
    `);

  return rs.recordset || [];
}

async function fetchLines(docEntry) {
  const pool = await getSapPool();
  const rs = await pool.request()
    .input('de', sapSql.Int, docEntry)
    .query(`
      SELECT LineNum,
             ItemCode      AS ItemCode,
             WhsCode       AS WarehouseCode,
             Quantity,
             OpenQty       AS OpenQuantity,
             Price,
             Currency,
             TaxCode,
             UoMCode,
             LineStatus
      FROM dbo.POR1 WITH (NOLOCK)
      WHERE DocEntry = @de
      ORDER BY LineNum;
    `);
  return rs.recordset || [];
}

// ---------- Sync principal ----------
async function syncCreatedPOsFromSAP() {
  // 1) Obtener cursor SAP (DATE + INT) ya con solape -1m calculado
  const { tsDate, tsTime } = await getCursorPartsForSAP();

  // 2) Traer cambios
  const headers = await fetchHeadersChangedAfter(tsDate, tsTime);

  // 3) Upsert
  let upserts = 0;
  for (const h of headers) {
    const lines = await fetchLines(h.DocEntry);
    await upsertPO(h, lines);
    upserts++;
  }

  // 4) Guardar cursor ahora (SQL o Node)
  await setLastCursorNow();

  return {
    usedFrom: { tsDate, tsTime },
    fetched: headers.length,
    upserts,
  };
}

// Alias cron antiguo
async function syncOpenPOsFromDB() { return syncCreatedPOsFromSAP(); }

module.exports = { syncCreatedPOsFromSAP, syncOpenPOsFromDB };
