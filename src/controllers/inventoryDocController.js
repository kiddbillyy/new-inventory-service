const { createInventoryDocDB, getInventoryDocDB, listInventoryDocsDB } = require('../models/inventoryDocModel');

function parseDate(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(+x) ? null : x;
}

function normType(t) {
  if (!t) return null;
  const up = String(t).trim().toUpperCase();
  return ['EM','SM','TT','EP'].includes(up) ? up : null;
}

function validateHeaderAndLines(header, lines) {
  const errors = [];

  if (!header) errors.push('Falta header');
  if (!Array.isArray(lines) || lines.length === 0) errors.push('Falta lines[]');

  const docType = normType(header?.docType ?? header?.type);
  if (!docType) errors.push('docType inválido (use EM, SM, TT o EP)');

  // Validaciones por tipo
  if (docType === 'EM') {
    // debe existir toWh a nivel header o por línea
    const hasAnyTo = (header?.toWh) || lines.some(l => l.toWh);
    if (!hasAnyTo) errors.push('EM requiere toWh (en header o en cada línea)');
  }
  if (docType === 'SM') {
    const hasAnyFrom = (header?.fromWh) || lines.some(l => l.fromWh);
    if (!hasAnyFrom) errors.push('SM requiere fromWh (en header o en cada línea)');
  }
  if (docType === 'TT') {
    if (!header?.fromWh && !lines.some(l => l.fromWh)) errors.push('TT requiere fromWh (header o línea)');
    if (!header?.toWh   && !lines.some(l => l.toWh))   errors.push('TT requiere toWh (header o línea)');
  }
  if (docType === 'EP') {
    // EP por OC: idealmente líneas con Base (poDocEntry/poLineNum).
    // Si no hay base, exigimos toWh como fallback.
    const allHaveBase = lines.length > 0 && lines.every(l => l.poDocEntry != null && l.poLineNum != null);
    const hasWarehouse = header?.toWh || lines.some(l => l.toWh);
    if (!allHaveBase && !hasWarehouse) {
      errors.push('EP requiere poDocEntry/poLineNum en líneas o un toWh (header o línea)');
    }
  }

  // Validación básica de líneas
  for (const [i, l] of (lines || []).entries()) {
    if (!l.itemSku) errors.push(`lines[${i}].itemSku requerido`);
    if (l.quantity == null || Number(l.quantity) <= 0) errors.push(`lines[${i}].quantity debe ser > 0`);
  }

  return { docType, errors };
}

async function createInventoryDocCtrl(req, res, next) {
  try {
    const { header = {}, lines = [], enqueue } = req.body || {};
    const { docType, errors } = validateHeaderAndLines(header, lines);

    if (errors.length) return res.status(400).json({ ok: false, errors });

    // Normalizamos alias type -> docType sólo por prolijidad
    header.docType = docType;

    // Enviar a BD (el model ya serializa metaJson y maneja enqueue)
    const data = await createInventoryDocDB(header, lines, enqueue !== false);
    return res.status(201).json({ ok: true, ...data });
  } catch (err) {
    next(err);
  }
}

async function getInventoryDocCtrl(req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ ok: false, error: 'id inválido' });
    const data = await getInventoryDocDB(id);
    if (!data.header) return res.status(404).json({ ok: false, error: 'Documento no encontrado' });
    return res.json({ ok: true, ...data });
  } catch (err) { next(err); }
}

async function listInventoryDocsCtrl(req, res, next) {
  try {
    const q = {
      docType: req.query.docType || null,
      status:  req.query.status  || null,
      dateFrom: parseDate(req.query.dateFrom),
      dateTo:   parseDate(req.query.dateTo),
      page:     parseInt(req.query.page || '1', 10),
      pageSize: Math.min(parseInt(req.query.pageSize || '50', 10), 500)
    };
    const data = await listInventoryDocsDB(q);
    return res.json({ ok: true, ...data });
  } catch (err) { next(err); }
}

module.exports = { createInventoryDocCtrl, getInventoryDocCtrl, listInventoryDocsCtrl };
