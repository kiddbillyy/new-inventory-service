const { normalizeType } = require('./types');
const { applyMovementDB, enqueueIntegrationDB } = require('../models/movementModel');

async function applyMovement(payload, { enqueue = true } = {}) {
  const type = normalizeType(payload.type);
  const movementId = await applyMovementDB({
    type, sku: payload.sku, fromWh: payload.fromWh, toWh: payload.toWh,
    quantity: payload.quantity, reference: payload.reference,
    metaJson: payload.metaJson, poDocEntry: payload.poDocEntry, poLineNum: payload.poLineNum
  });
  if (enqueue && ['EM','SM','TT','EP'].includes(type)) {
    await enqueueIntegrationDB(movementId);
  }
  return { movementId, type };
}

module.exports = { applyMovement };
