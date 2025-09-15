const { getCheckpoint, saveCheckpoint } = require('../models/syncModel');
const { upsertPurchaseOrderDB } = require('../models/poModel');

(async function run() {
  console.log('[job] sap sync started');
  const cp = (await getCheckpoint('purchase_orders')) || { lastUpdateDate: null, lastUpdateTime: null, lastDocEntry: null };
  // TODO: consulta a SAP por UpdateDate/Time/DocEntry > checkpoint
  // Simulación mínima:
  const header = { poDocEntry: 90001, vendorCode: 'V100', docDate: new Date(), docStatus: 'O' };
  const lines  = [{ poDocEntry: 90001, lineNum: 0, itemSku: '001001001', warehouseCode: '01', orderedQty: 10, openQty: 10, lineStatus: 'O' }];
  await upsertPurchaseOrderDB(header, lines);
  await saveCheckpoint('purchase_orders', new Date(), 930, 90001);
})();
