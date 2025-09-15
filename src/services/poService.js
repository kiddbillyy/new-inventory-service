// src/services/poService.js
const { upsertPurchaseOrderDB } = require('../models/poModel');

function normalizeHeader(h) {
  return {
    poDocEntry:  h.poDocEntry  ?? h.DocEntry,
    docNum:      h.docNum      ?? h.DocNum      ?? null,
    series:      h.series      ?? h.Series      ?? null,
    vendorCode:  h.vendorCode  ?? h.CardCode    ?? null,
    vendorName:  h.vendorName  ?? h.CardName    ?? null,
    docDate:     h.docDate     ?? h.DocDate     ?? null,
    docDueDate:  h.docDueDate  ?? h.DocDueDate  ?? null,
    docStatus:   h.docStatus   ?? h.DocStatus   ?? 'O',
    cancelled:   h.cancelled   ?? (h.Canceled ? 1 : 0),
    currency:    h.currency    ?? h.DocCurrency ?? null,
    docTotal:    h.docTotal    ?? h.DocTotal    ?? null,
    comments:    h.comments    ?? h.Comments    ?? null
  };
}

function normalizeLines(lines, header) {
  const poEntryFromHeader = header.DocEntry ?? header.poDocEntry;
  return (lines || []).map(l => ({
    poDocEntry:    l.poDocEntry    ?? l.DocEntry ?? poEntryFromHeader,
    lineNum:       l.lineNum       ?? l.LineNum ?? 0,
    itemSku:       l.itemSku       ?? l.ItemCode ?? '',
    warehouseCode: l.warehouseCode ?? l.WhsCode  ?? l.WarehouseCode ?? null,
    orderedQty:    l.orderedQty    ?? l.Quantity ?? null,
    openQty:       l.openQty       ?? l.OpenQuantity ?? null,
    price:         l.price         ?? l.Price ?? null,
    currency:      l.currency      ?? l.Currency ?? header.DocCurrency ?? null,
    taxCode:       l.taxCode       ?? l.TaxCode ?? null,
    uomCode:       l.uomCode       ?? l.UoMCode ?? null,
    lineStatus:    (()=>{
      const s = l.lineStatus ?? l.LineStatus;
      if (s === 'C' || s === 'bost_Closed') return 'C';
      return 'O';
    })()
  }));
}

async function upsertPO(header, lines) {
  const H = normalizeHeader(header);
  const L = normalizeLines(lines, header);
  return upsertPurchaseOrderDB(H, L);
}

module.exports = { upsertPO };
