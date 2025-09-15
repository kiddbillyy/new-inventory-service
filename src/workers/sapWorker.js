// src/workers/sapWorker.js
const axios = require('axios');
const https = require('https');
const { getPool, sql } = require('../config/db');

const baseURL    = process.env.SAP_BASE_URL;     // p.ej. https://host:50000/b1s/v1
const COMPANY_DB = process.env.SAP_COMPANY_DB;
const SAP_USER   = process.env.SAP_USERNAME;
const SAP_PASS   = process.env.SAP_PASSWORD;

const LOG_SAP = process.env.LOG_SAP === '1';     // 👈 habilita logs de request/response a SAP

const agent = new https.Agent({ rejectUnauthorized: false });
let session = null;

/* ---------- Auth ---------- */
async function login() {
  if (session?.cookie) return session;
  const resp = await axios.post(`${baseURL}/Login`, {
    CompanyDB: COMPANY_DB, UserName: SAP_USER, Password: SAP_PASS
  }, { httpsAgent: agent, timeout: 60000 });
  // Incluye B1SESSION y ROUTEID si viene
  const cookie = resp.headers['set-cookie']?.map(c => c.split(';')[0]).join('; ');
  session = { cookie };
  return session;
}
async function logout() {
  if (!session?.cookie) return;
  try {
    await axios.post(`${baseURL}/Logout`, {}, { headers: { Cookie: session.cookie }, httpsAgent: agent, timeout: 30000 });
  } catch {}
  session = null;
}

/* ---------- Helpers ---------- */
function parseMeta(metaJson) {
  if (!metaJson) return {};
  try { return typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson; }
  catch { return {}; }
}
function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([,v]) => v !== undefined));
}
function mapSkuToItemCode(sku) {
  // Si necesitas mapear SKU ≠ ItemCode de SAP, cambia aquí o consulta una tabla.
  return sku;
}
function extractSAPError(e) {
  if (e?.response?.data) {
    try { return JSON.stringify(e.response.data); } catch { return String(e.response.data); }
  }
  return e?.message || String(e);
}
function isInvalidSessionError(e) {
  const code = e?.response?.data?.error?.code;
  const msg  = e?.response?.data?.error?.message?.value || e?.message || '';
  // SAP SL suele devolver code 301 y/o 401 con ese texto
  return code === 301 || /invalid session|session.*timeout/i.test(msg) || e?.response?.status === 401;
}

async function insertSapDocSnapshot(pool, {
  queueId = null,
  documentId = null,
  docType = null,
  sapObject = null,
  sapDocEntry = null,
  sapDocNum = null,
  payloadJson = null,
  responseJson = null,   // opcional: si quieres guardar respuesta de SAP
  series = null          // opcional: si usas series
}) {
  await pool.request()
    .input('queueId',     sql.BigInt,        queueId)
    .input('documentId',  sql.Int,           documentId)
    .input('docType',     sql.NVarChar(20),  docType)
    .input('sapObject',   sql.NVarChar(50),  sapObject)
    .input('sapDocEntry', sql.Int,           sapDocEntry)
    .input('sapDocNum',   sql.Int,           sapDocNum)
    .input('payload',     sql.NVarChar(sql.MAX), payloadJson)
    .input('response',    sql.NVarChar(sql.MAX), responseJson)
    .input('series',      sql.Int,           series)
    .query(`
      DECLARE @qid BIGINT = @queueId;

      IF @qid IS NULL AND @documentId IS NOT NULL AND OBJECT_ID('dbo.IntegrationQueue','U') IS NOT NULL
      BEGIN
        SELECT TOP (1) @qid = id
        FROM dbo.IntegrationQueue
        WHERE documentId = @documentId
        ORDER BY createdAt DESC;
      END

      IF @qid IS NULL SET @qid = -1; -- último recurso para no romper

      -- Inserta en SapDocuments (tu tabla con queueId NOT NULL)
      IF OBJECT_ID('dbo.SapDocuments','U') IS NOT NULL
      BEGIN
        INSERT INTO dbo.SapDocuments (
          queueId, documentId, docType, sapObject, sapDocEntry, sapDocNum,
          payload, responseJson, series, createdAt
        )
        VALUES (@qid, @documentId, @docType, @sapObject, @sapDocEntry, @sapDocNum,
                @payload, @response, @series, SYSDATETIME());
      END
      ELSE IF OBJECT_ID('dbo.sapdocuments','U') IS NOT NULL
      BEGIN
        -- Versión antigua sin queueId obligatorio
        INSERT INTO dbo.sapdocuments (
          documentId, docType, sapObject, sapDocEntry, sapDocNum, payload, createdAt
        )
        VALUES (@documentId, @docType, @sapObject, @sapDocEntry, @sapDocNum, @payload, SYSDATETIME());
      END
    `);
}

/* ---------- Envoltorio con re-login y retry + logs ---------- */
async function slPost(path, body) {
  if (LOG_SAP) {
    console.log(`[SAP REQ] POST ${path}\n${JSON.stringify(body, null, 2)}`);
  }

  await login();
  try {
    const resp = await axios.post(`${baseURL}${path}`, body, {
      headers: { Cookie: session.cookie },
      httpsAgent: agent,
      timeout: 60000
    });
    if (LOG_SAP) {
      console.log(`[SAP RES] ${resp.status} ${resp.statusText} -> ${path}  DocEntry=${resp.data?.DocEntry} DocNum=${resp.data?.DocNum}`);
    }
    return resp;
  } catch (e) {
    if (!isInvalidSessionError(e)) {
      if (LOG_SAP) console.error(`[SAP ERR] ${path}\n${extractSAPError(e)}`);
      throw e;
    }
    if (LOG_SAP) console.warn('[SAP REQ] sesión inválida/expirada → re-login y reintento');
    await logout();
    await login();
    const resp = await axios.post(`${baseURL}${path}`, body, {
      headers: { Cookie: session.cookie },
      httpsAgent: agent,
      timeout: 60000
    });
    if (LOG_SAP) {
      console.log(`[SAP RES] ${resp.status} ${resp.statusText} -> ${path}  DocEntry=${resp.data?.DocEntry} DocNum=${resp.data?.DocNum}`);
    }
    return resp;
  }
}

/* ---------- Builders por tipo ---------- */
function buildOPDN(header, lines) { // EP → PurchaseDeliveryNotes (GRPO)
  const meta = parseMeta(header.metaJson);
  const docDate = (meta.DocDate || header.postingDate)
    ? new Date(meta.DocDate || header.postingDate).toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);

  return clean({
    DocDate: docDate,
    DocDueDate: meta.DocDueDate || docDate,
    Comments: header.reference || null,
    DocumentSubType: meta.DocumentSubType || 'bost_Normal',
    Series: meta.Series,                 // en muchos setups es numérico
    Indicator: meta.Indicator,
    FolioPrefixString: meta.FolioPrefixString,
    FolioNumber: meta.FolioNumber,
    CardCode: meta.CardCode || header.vendorCode || cardCode || undefined,
    DocumentLines: lines.map(l => {
      const hasBase = l.poDocEntry != null && l.poLineNum != null;
      if (hasBase) {
        // Con base a OC (como tu ejemplo); Quantity opcional
        return clean({
          BaseType: 22,                  // Purchase Orders
          BaseEntry: l.poDocEntry,
          BaseLine: l.poLineNum,
          Quantity: l.quantity != null ? Number(l.quantity) : undefined
        });
      }
      // Sin base: ItemCode/Warehouse/Quantity
      return clean({
        ItemCode: mapSkuToItemCode(l.itemSku),
        Quantity: Number(l.quantity),
        WarehouseCode: l.toWarehouseCode || header.toWarehouseCode || null
      });
    })
  });
}

function buildOIGN(header, lines) { // EM → InventoryGenEntries
  const meta = parseMeta(header.metaJson);
  const docDate = (meta.DocDate || header.postingDate)
    ? new Date(meta.DocDate || header.postingDate).toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);
  return {
    DocDate: docDate,
    Comments: header.reference || null,
    DocumentLines: lines.map(l => ({
      WarehouseCode: l.toWarehouseCode || header.toWarehouseCode || null,
      ItemCode: mapSkuToItemCode(l.itemSku),
      Quantity: Number(l.quantity)
    }))
  };
}

function buildOIGE(header, lines) { // SM → InventoryGenExits
  const meta = parseMeta(header.metaJson);
  const docDate = (meta.DocDate || header.postingDate)
    ? new Date(meta.DocDate || header.postingDate).toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);
  return {
    DocDate: docDate,
    Comments: header.reference || null,
    DocumentLines: lines.map(l => ({
      WarehouseCode: l.fromWarehouseCode || header.fromWarehouseCode || null,
      ItemCode: mapSkuToItemCode(l.itemSku),
      Quantity: Number(l.quantity)
    }))
  };
}

function buildOWTR(header, lines) { // TT → StockTransfers (OWTR)
  const meta = parseMeta(header.metaJson);
  const docDate = (meta.DocDate || header.postingDate)
    ? new Date(meta.DocDate || header.postingDate).toISOString().slice(0,10)
    : new Date().toISOString().slice(0,10);
  return {
    DocDate: docDate,
    Comments: header.reference || null,
    FromWarehouse: header.fromWarehouseCode,
    ToWarehouse: header.toWarehouseCode,
    StockTransferLines: lines.map(l => ({
      ItemCode: mapSkuToItemCode(l.itemSku),
      Quantity: Number(l.quantity),
      FromWarehouseCode: l.fromWarehouseCode || header.fromWarehouseCode,
      WarehouseCode: l.toWarehouseCode || header.toWarehouseCode
    }))
  };
}

/* ---------- POST por tipo (usa slPost con retry) ---------- */
async function postByType(doc) {
  const type = doc.docType;

  if (type === 'EP') {
    const cardCode = await deriveCardCodeForEP(doc.lines); 
    const body = buildOPDN(doc, doc.lines,cardCode );
    const resp = await slPost('/PurchaseDeliveryNotes', body);
    return { sapObject: 'OPDN', sapDocEntry: resp.data?.DocEntry, sapDocNum: resp.data?.DocNum, body };
  }
  if (type === 'EM') {
    const body = buildOIGN(doc, doc.lines);
    const resp = await slPost('/InventoryGenEntries', body);
    return { sapObject: 'OIGN', sapDocEntry: resp.data?.DocEntry, sapDocNum: resp.data?.DocNum, body };
  }
  if (type === 'SM') {
    const body = buildOIGE(doc, doc.lines);
    const resp = await slPost('/InventoryGenExits', body);
    return { sapObject: 'OIGE', sapDocEntry: resp.data?.DocEntry, sapDocNum: resp.data?.DocNum, body };
  }
  if (type === 'TT') {
    const body = buildOWTR(doc, doc.lines);
    const resp = await slPost('/StockTransfers', body); // ✅ endpoint correcto
    return { sapObject: 'OWTR', sapDocEntry: resp.data?.DocEntry, sapDocNum: resp.data?.DocNum, body };
  }
  throw new Error(`Tipo no soportado para SL: ${type}`);
}

/* ---------- Utilidades DB ---------- */
async function loadDoc(docId) {
  const pool = await getPool();
  const h = await pool.request().input('id', sql.Int, docId)
    .query('SELECT * FROM dbo.InventoryDocuments WHERE id=@id');
  const l = await pool.request().input('id', sql.Int, docId)
    .query('SELECT * FROM dbo.InventoryDocumentLines WHERE documentId=@id ORDER BY id');
  const header = h.recordset?.[0];
  if (!header) throw new Error(`Documento ${docId} no existe`);
  return { ...header, lines: l.recordset || [] };
}
async function markDone(iqId, docId, sapDocEntry, sapDocNum, sapObject, body) {
  const pool = await getPool();

  await pool.request()
    .input('docId', sql.Int, docId)
    .input('sapDocEntry', sql.Int, sapDocEntry || null)
    .input('sapDocNum',   sql.Int, sapDocNum || null)
    .query(`
      UPDATE dbo.InventoryDocuments
      SET sapDocEntry=@sapDocEntry, sapDocNum=@sapDocNum, status='POSTED', updatedAt=SYSDATETIME()
      WHERE id=@docId;
    `);

  // snapshot (éxito) con queueId
  await insertSapDocSnapshot(pool, {
    queueId: iqId,
    documentId: docId,
    docType: (sapObject === 'OPDN' ? 'EP' : sapObject === 'OWTR' ? 'TT' : sapObject === 'OIGN' ? 'EM' : 'SM'),
    sapObject,
    sapDocEntry,
    sapDocNum,
    payloadJson: JSON.stringify(body)
  });

  await pool.request().input('id', sql.Int, iqId)
    .query(`UPDATE dbo.IntegrationQueue
            SET [status]='DONE', retries=retries+1, updatedAt=SYSDATETIME()
            WHERE id=@id;`);
}

async function markFailedWithSnapshot(iqId, err, doc, body, sapObjectGuess) {
  const pool = await getPool();
  const msg = extractSAPError(err).substring(0, 4000);

  // Actualiza cola con error
  await pool.request()
    .input('id', sql.Int, iqId)
    .input('err', sql.NVarChar(4000), msg)
    .query(`UPDATE dbo.IntegrationQueue
            SET [status]='FAILED', retries=retries+1, errorMsg=@err, updatedAt=SYSDATETIME()
            WHERE id=@id;`);

  // 💾 snapshot del request fallido
  await insertSapDocSnapshot(pool, {
    documentId: doc?.id ?? null,
    docType: doc?.docType ?? null,
    sapObject: sapObjectGuess ?? null,
    sapDocEntry: null,
    sapDocNum: null,
    payloadJson: body ? JSON.stringify(body) : null
  });

  console.error('[SAP ERROR]', msg);
}

async function markFailed(iqId, err, doc = null, body = null, sapObjectGuess = null) {
  const pool = await getPool();
  const msg = extractSAPError(err).substring(0, 4000);
  console.error('[SAP ERROR]', msg);

  await pool.request()
    .input('id', sql.Int, iqId)
    .input('err', sql.NVarChar(4000), msg)
    .query(`UPDATE dbo.IntegrationQueue
            SET [status]='FAILED', retries=retries+1, errorMsg=@err, updatedAt=SYSDATETIME()
            WHERE id=@id;`);

  // snapshot (fallo) con queueId
  await insertSapDocSnapshot(pool, {
    queueId: iqId,
    documentId: doc?.id ?? null,
    docType: doc?.docType ?? null,
    sapObject: sapObjectGuess ?? null,
    payloadJson: body ? JSON.stringify(body) : null,
    responseJson: msg
  });
}

/* ---------- Dispatcher genérico ---------- */
async function dispatchBatch(limit = 10) {
  const pool = await getPool();
  const q = await pool.request().input('limit', sql.Int, limit).query(`
    SELECT TOP (@limit) iq.id AS iqId,
                         iq.documentId,
                         d.docType
    FROM dbo.IntegrationQueue iq
    JOIN dbo.InventoryDocuments d ON d.id = iq.documentId
    WHERE iq.[status]='PENDING'
      AND d.docType IN ('EP','TT','EM','SM')
    ORDER BY iq.createdAt ASC;
  `);

  const rows = q.recordset || [];
  let ok = 0, fail = 0, results = [];

  for (const r of rows) {
    let doc, body, sapObject, path;
    try {
      doc = await loadDoc(r.documentId);

      if (doc.docType === 'EP') { sapObject='OPDN'; path='/PurchaseDeliveryNotes'; body = buildOPDN(doc, doc.lines); }
      else if (doc.docType === 'EM') { sapObject='OIGN'; path='/InventoryGenEntries'; body = buildOIGN(doc, doc.lines); }
      else if (doc.docType === 'SM') { sapObject='OIGE'; path='/InventoryGenExits'; body = buildOIGE(doc, doc.lines); }
      else if (doc.docType === 'TT') { sapObject='OWTR'; path='/StockTransfers'; body = buildOWTR(doc, doc.lines); }
      else throw new Error(`Tipo no soportado: ${doc.docType}`);

      const resp = await slPost(path, body);

      await markDone(r.iqId, r.documentId, resp.data?.DocEntry, resp.data?.DocNum, sapObject, body);
      results.push({ iqId: r.iqId, documentId: r.documentId, docType: r.docType, sapObject,
                     sapDocEntry: resp.data?.DocEntry, sapDocNum: resp.data?.DocNum });
      ok++;
    } catch (e) {
      await markFailedWithSnapshot(r.iqId, e, doc || { id: r.documentId, docType: r.docType }, body, sapObject);
      results.push({ iqId: r.iqId, documentId: r.documentId, docType: r.docType, error: e.message || String(e) });
      fail++;
    }
  }
  return { processed: rows.length, ok, fail, results };
}
module.exports = {
  dispatchBatch,
  // exporto builders por si quieres un endpoint de preview
  buildOPDN, buildOIGN, buildOIGE, buildOWTR
};
