// src/kafka/poEventsConsumer.js
const { Kafka, logLevel } = require('kafkajs');
const { recordEvent, markEventDone, markEventFailed } = require('../models/eventInboxModel');
const { upsertPO } = require('../services/poService');

const BROKERS = (process.env.KAFKA_BROKER || 'kafka:9092').split(',');
const GROUP_ID = process.env.KAFKA_GROUP_ID || 'inventory-service-po-events';

// ✅ Puedes pasar varios tópicos separados por coma
//   KAFKA_PO_TOPICS=sap.purchaseorder.cancelled,sap.purchaseorder.updated
const TOPICS = (process.env.KAFKA_PO_TOPICS || process.env.KAFKA_PO_TOPIC || 'sap.purchaseorder.cancelled')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ✅ O suscribirte por patrón (regex). Ej: ^sap\.purchaseorder\.
const TOPIC_PATTERN = process.env.KAFKA_PO_TOPIC_PATTERN
  ? new RegExp(process.env.KAFKA_PO_TOPIC_PATTERN)
  : null;

// ✅ Leer desde el comienzo (para pruebas)
const FROM_BEGINNING = process.env.KAFKA_FROM_BEGINNING === '1';

// ✅ Log del payload crudo (para diagnosticar)
const LOG_MSG = process.env.KAFKA_LOG_MSG === '1';

function parseJSON(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch { return null; }
}

function truthy(x) { return x === 1 || x === '1' || x === true || x === 'Y' || x === 'y'; }

// Normaliza distintos nombres de evento a "cancelled"
function isCancelledEventName(evt) {
  if (!evt) return false;
  if (evt === 'PurchaseOrder.Cancelled') return true;
  return /purchaseorder\.cancelled$/i.test(evt);
}

// Construye header para tu SP (formato esperado en poModel.upsertPurchaseOrderDB)
function buildCancelHeaderFromEvent(o) {
  return {
    poDocEntry:  Number(o.docEntry),                 // clave primaria
    docNum:      o.docNum ?? null,
    series:      o.series ?? null,                   // si viniera
    vendorCode:  o.supplier?.code ?? o.CardCode ?? null,
    vendorName:  o.supplier?.name ?? o.CardName ?? null,
    docDate:     o.docDate ?? null,                  // se permite null
    docDueDate:  null,                               // no requerido para cancelar
    docStatus:   'C',
    cancelled:   truthy(o.canceled) ? 1 : 1,         // forzamos 1
    currency:    null,
    docTotal:    null,
    comments:    'Cancelled by event'
  };
}

// Handler de cancelación
async function handlePurchaseOrderCancelled(msgObj, raw) {
  const idem = msgObj.idempotencyKey || `PO-CANCELLED-${msgObj.docEntry}`;
  const { id, inserted, status } = await recordEvent({
    source: msgObj.source || 'UNKNOWN',
    event:  msgObj.event  || 'UNKNOWN',
    idempotencyKey: idem,
    payload: JSON.stringify(raw)
  });

  // Ya procesado con éxito
  if (!inserted && status === 'DONE') return;

  try {
    const header = buildCancelHeaderFromEvent(msgObj);
    if (!header.poDocEntry || !Number.isInteger(header.poDocEntry)) {
      throw new Error(`docEntry inválido en evento: ${msgObj.docEntry}`);
    }

    // Sin líneas: el SP debe cerrar líneas localmente si docStatus='C' o cancelled=1
    await upsertPO(header, []);

    await markEventDone(id);
  } catch (e) {
    await markEventFailed(id, e.message || e);
    throw e;
  }
}

// Router de eventos
async function dispatchEvent(obj, raw) {
  if (isCancelledEventName(obj?.event) && String(obj?.objType) === '22') {
    return handlePurchaseOrderCancelled(obj, raw);
  }

  // Otros eventos → opcional: registrar como recibido (no error)
  await recordEvent({
    source: obj?.source || 'UNKNOWN',
    event:  obj?.event  || 'UNKNOWN',
    idempotencyKey: obj?.idempotencyKey || `UNHANDLED-${raw.topic}-${raw.partition}-${raw.offset}`,
    payload: JSON.stringify(raw)
  });
}

async function startPoEventsConsumer() {
  const kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID || 'inventory-service',
    brokers: BROKERS,
    logLevel: logLevel.WARN
  });

  const consumer = kafka.consumer({ groupId: GROUP_ID });

  await consumer.connect();

  if (TOPIC_PATTERN) {
    await consumer.subscribe({ topic: TOPIC_PATTERN, fromBeginning: FROM_BEGINNING });
    console.log(`[Kafka] subscribed by pattern: ${TOPIC_PATTERN} (fromBeginning=${FROM_BEGINNING})`);
  } else {
    for (const t of TOPICS) {
      await consumer.subscribe({ topic: t, fromBeginning: FROM_BEGINNING });
    }
    console.log(`[Kafka] subscribed topics: ${TOPICS.join(', ')} (fromBeginning=${FROM_BEGINNING})`);
  }

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ topic, partition, message }) => {
      const keyStr = message.key?.toString() || '';
      const valStr = message.value?.toString() || '';

      if (LOG_MSG) {
        console.log(`[Kafka] msg topic=${topic} part=${partition} off=${message.offset} key=${keyStr} val=${valStr.slice(0, 2000)}`);
      } else {
        console.log(`[Kafka] msg topic=${topic} part=${partition} off=${message.offset} key=${keyStr}`);
      }

      const raw = {
        key:   keyStr,
        value: valStr,
        headers: Object.fromEntries(Object.entries(message.headers || {}).map(([k,v]) => [k, v?.toString()])),
        topic, partition, offset: message.offset
      };

      const obj = parseJSON(message.value);
      if (!obj) {
        await recordEvent({
          source: 'UNKNOWN', event: 'UNPARSEABLE',
          idempotencyKey: `UNPARSEABLE-${topic}-${partition}-${message.offset}`,
          payload: valStr
        });
        return;
      }

      try {
        await dispatchEvent(obj, raw);
      } catch (e) {
        console.error('[Kafka] handler error:', e.message || e);
      }
    }
  });

  return consumer;
}

module.exports = { startPoEventsConsumer };
