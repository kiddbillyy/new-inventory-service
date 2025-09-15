// src/models/movementModel.js
const { getPool, sql } = require('../config/db');

function normalizeType(t) {
  if (!t) return null;
  const x = String(t).trim().toUpperCase();
  // aliases legacy → actuales (opcional)
  if (x === 'GR') return 'EM';
  if (x === 'GI') return 'SM';
  if (x === 'GRPO') return 'EP';
  if (x === 'SORES') return 'FR';
  if (x === 'SOREL') return 'NV';
  return x;
}

async function applyMovementDB(p) {
  const pool = await getPool();

  const type = normalizeType(p.type);
  if (!type) throw new Error('type requerido');
  if (!p.sku) throw new Error('sku requerido');
  if (!p.quantity || Number(p.quantity) <= 0) throw new Error('quantity > 0 requerido');

  const req = pool.request()
    // usa los NOMBRES y tamaños del SP
    .input('type',       sql.NVarChar(20), type)
    .input('itemSku',    sql.NVarChar(100), p.sku)
    .input('fromWhCode', sql.NVarChar(40), p.fromWh ?? null)
    .input('toWhCode',   sql.NVarChar(40), p.toWh ?? null)
    .input('quantity',   sql.Decimal(18, 3), p.quantity)      // la conversión a DECIMAL del SP es implícita
    .input('reference',  sql.NVarChar(200), p.reference ?? null)
    .input('metaJson',   sql.NVarChar(sql.MAX),
           p.metaJson ? (typeof p.metaJson === 'string' ? p.metaJson : JSON.stringify(p.metaJson)) : null);

  // ⚠️ NO enviar poDocEntry / poLineNum: tu SP no los tiene
  const result = await req.execute('dbo.apply_movement');

  // Si tu SP no retorna movementId, hacemos fallback al último insert (riesgo bajo en test)
  const { recordset } = await pool.request()
    .query('SELECT TOP 1 id AS movementId FROM dbo.StockMovements ORDER BY id DESC');
  return recordset[0]?.movementId ?? null;
}

async function enqueueIntegrationDB(movementId) {
  const pool = await getPool();
  await pool.request()
    .input('movementId', sql.BigInt, movementId)
    .execute('dbo.enqueue_integration'); // usa solo si NO encolas desde el SP
}

async function listMovementsDB(q) {
  const pool = await getPool();
  const req = pool.request()
    .input('sku', sql.NVarChar(50), q.sku || null)
    .input('type', sql.NVarChar(10), q.type || null)
    .input('wh', sql.NVarChar(20), q.wh || null)
    .input('status', sql.NVarChar(20), q.status || null)
    .input('dateFrom', sql.DateTime2, q.dateFrom || null)
    .input('dateTo', sql.DateTime2, q.dateTo || null)
    .input('page', sql.Int, q.page || 1)
    .input('pageSize', sql.Int, q.pageSize || 50);

  const result = await req.execute('dbo.list_movements');
  return { rows: result.recordsets[0] || [], total: result.recordsets[1]?.[0]?.Total ?? 0 };
}

module.exports = { applyMovementDB, enqueueIntegrationDB, listMovementsDB };
