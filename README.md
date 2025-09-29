# Inventory Service

Microservicio que centraliza **stock por bodega**, **movimientos** (EM/SM/TT/EP), sincroniza **Órdenes de Compra (PO)** desde SAP y publica documentos en **SAP Business One** vía **Service Layer**. Expone API REST, procesa colas de integración y consume eventos Kafka.

---

## ✨ Características

- **Stock en tiempo real** por SKU/Bodega: `onHand`, `salesCommit`, `purchaseOrd`, **available**.
- **Movimientos**:  
  - **EM** = Entrada manual (OIGN)  
  - **SM** = Salida manual (OIGE)  
  - **TT** = Traslado (OWTR)  
  - **EP** = Entrada por OC (GRPO/OPDN, con BaseType=22)
- **Documentos** multi-línea con **idempotencia** (`IntegrationQueue`).
- **Integración SAP (Service Layer)**: login/refresh, payloads, manejo de errores y **snapshots** en `SapDocuments`.
- **PO Sync**: consulta directa a BD SAP (SQL Server) de **OC abiertas/actualizadas** desde la última ejecución (–1 min) + **eventos Kafka** (p.ej. cancelaciones).
- **Flags por bodega**: `blocked`, `safetyStock`, `infiniteStock`.
- **Auditoría**: `IntegrationQueue`, `SapDocuments`, `EventInbox`.

> Disponible SAP-like: `onHandQty - salesCommitQty + purchaseOrdQty`.  
> Reglas: `blocked=1` → disponible 0; `infiniteStock=1` → “ilimitado”; `safetyStock` descuenta del disponible.

---

## 🏗️ Arquitectura

```
               +---------------------------+
               |         Catalog MS        |  (opcional: enriquecer UI)
               +-------------+-------------+
                             |
                             | (no acoplar: este MS expone solo stock)
                             v
+-----------+       REST        +--------------------+          +--------------------+
|  Client   |  <--------------> |  Inventory Service |  <-----> |   SQL Server (MS)  |
+-----------+                   | (Express/Node.js)  |          |  new_inventory_*   |
                                +----+----------+----+          +--------------------+
                                     |          |
                                     |          | cron (*/1m) / workers
                                     |          v
                                     |     +-----------+   Service Layer (HTTPS)
                                     |     | SapWorker |--------------------------+
                                     |     +-----------+                          |
                                     |                                            v
                                     |                                   SAP B1 /b1s/v1
                                     |
                                     | cron (*/5m) / DB sync
                                     v
                                +-----------+
                                |  PO Sync  |  --->  SQL Server (SAP DB)
                                +-----------+

                           Kafka (kafkajs)
                      ^------------------------^
                      |  sap.purchaseorder.*   |
```

---

## 📁 Estructura

```
src/
  config/
    db.js           # pool MSSQL (inventario)
    sapDb.js        # pool MSSQL (SAP DB)
    env.js          # lectura de .env
  controllers/
    inventoryDocController.js
    poController.js
    stockController.js
    movementsController.js
  models/
    inventoryDocModel.js
    poModel.js
    stockModel.js
    movementsModel.js
    eventInboxModel.js
  routes/
    inventoryDocs.routes.js
    po.routes.js
    stock.routes.js
    movements.routes.js
    health.routes.js
    integration.routes.js
  services/
    poService.js
  workers/
    sapWorker.js
    cronRunner.js
  kafka/
    poEventsConsumer.js
server.js
```

---

## 🗄️ Esquema (resumen)

- `Items(sku PK, ..., blocked BIT, safetyStock DECIMAL(18,3), infiniteStock BIT, usuario NVARCHAR(100))`
- `Warehouses(code PK, ...)`
- `ItemWarehouseStock(id, itemSku FK, warehouseCode FK, onHandQty, salesCommitQty, purchaseOrdQty, blocked, safetyStock, infiniteStock, updatedAt)`
- `StockMovements(id BIGINT, type, itemSku, fromWh, toWh, quantity, reference, metaJson, status, createdAt, …)`
- `MovementTypes(code,name)` → { EM, SM, TT, EP, FR, NV … }
- `InventoryDocuments(id, docType {EP,EM,SM,TT}, fromWarehouseCode, toWarehouseCode, postingDate, reference, metaJson, externalRef, status {APPLIED/POSTED}, sapDocEntry, sapDocNum, createdAt, updatedAt)`
- `InventoryDocumentLines(id, documentId FK, itemSku, fromWarehouseCode, toWarehouseCode, quantity, poDocEntry NULL, poLineNum NULL)`
- `IntegrationQueue(id, type {'INVENTORY_DOC',...}, documentId, idempotencyKey, status {PENDING/DONE/FAILED}, retries, errorMsg, createdAt, updatedAt)`
- `SapDocuments(id, queueId NOT NULL, documentId, docType, sapObject, sapDocEntry, sapDocNum, payload, responseJson, series, createdAt)`
- `PurchaseOrders(poDocEntry PK, docNum, series, vendorCode, vendorName, docDate, docDueDate, docStatus {O/C}, cancelled BIT, currency, docTotal, comments, createdAt, updatedAt)`
- `PurchaseOrderLines(poDocEntry FK, lineNum, itemSku, warehouseCode, orderedQty, openQty, price, currency, taxCode, uomCode, lineStatus {O/C}, updatedAt)`
- `EventInbox(id, source, event, idempotencyKey UNIQUE, payload, status {PENDING/DONE/FAILED}, errorMsg, createdAt, updatedAt)`
- `SyncState([key] PK, value, updatedAt)` → p. ej. `PO_LAST_RUN`

---

## 🔐 Permisos SQL sugeridos

```sql
GRANT REFERENCES ON TYPE::dbo.PurchaseOrderLineType     TO user_inventory;
GRANT REFERENCES ON TYPE::dbo.InventoryDocumentLineType TO user_inventory;
GRANT EXECUTE   ON dbo.upsert_purchase_order            TO user_inventory;
GRANT EXECUTE   ON dbo.apply_inventory_document         TO user_inventory;
GRANT EXECUTE   ON dbo.list_movements                   TO user_inventory;
GRANT EXECUTE   ON dbo.enqueue_integration              TO user_inventory;

GRANT SELECT ON dbo.ItemWarehouseStock TO user_inventory;
GRANT SELECT ON dbo.PurchaseOrders, dbo.PurchaseOrderLines TO user_inventory;
GRANT SELECT ON dbo.InventoryDocuments, dbo.InventoryDocumentLines TO user_inventory;
GRANT SELECT ON dbo.IntegrationQueue, dbo.SapDocuments, dbo.EventInbox, dbo.SyncState TO user_inventory;
```

---

## ⚙️ Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP |
| `DB_HOST`,`DB_PORT`,`DB_NAME`,`DB_USER`,`DB_PASSWORD` | BD inventario |
| `SAP_BASE_URL` | Service Layer (`https://host:50000/b1s/v1`) |
| `SAP_COMPANY_DB`,`SAP_USERNAME`,`SAP_PASSWORD` | Credenciales SL |
| `SAP_DB_HOST`,`SAP_DB_NAME`,`SAP_DB_USER`,`SAP_DB_PASSWORD` | BD SAP (sync por consulta) |
| `LOG_SAP` | `1` para log de payloads/respuestas |
| `ENABLE_CRON` | `1` para habilitar cron |
| `SAP_WORKER_BATCH` | Lote por ciclo del worker |
| `KAFKA_ENABLE` | `1` para consumer Kafka |
| `KAFKA_BROKER`,`KAFKA_CLIENT_ID`,`KAFKA_GROUP_ID` | Config Kafka |
| `KAFKA_PO_TOPICS` o `KAFKA_PO_TOPIC_PATTERN` | Suscripción por lista o regex |
| `KAFKA_FROM_BEGINNING` | `1` para leer histórico |
| `KAFKA_LOG_MSG` | `1` para loguear mensajes |

Ejemplo `.env` mínimo:
```env
PORT=5005
DB_HOST=host.docker.internal
DB_PORT=1433
DB_NAME=new_inventory_service_db
DB_USER=user_inventory
DB_PASSWORD=*****

SAP_BASE_URL=https://win-hp03dio6fsk:50000/b1s/v1
SAP_COMPANY_DB=COMERCIAL_CIERRE_TEST
SAP_USERNAME=manager
SAP_PASSWORD=mngr
LOG_SAP=1

SAP_DB_HOST=192.168.0.24
SAP_DB_NAME=COMERCIAL_CIERRE_TEST
SAP_DB_USER=sa
SAP_DB_PASSWORD=*****

ENABLE_CRON=1
SAP_WORKER_BATCH=10

KAFKA_ENABLE=1
KAFKA_BROKER=kafka:9092
KAFKA_CLIENT_ID=inventory-service
KAFKA_GROUP_ID=inventory-service-po-events
KAFKA_PO_TOPICS=sap.purchaseorder.cancelled
KAFKA_FROM_BEGINNING=1
KAFKA_LOG_MSG=1
```

---

## 🐳 Docker Compose

```yaml
version: '3.8'
networks:
  orders-service_kafka_network:
    external: true

services:
  inventory-service:
    build: .
    container_name: inventory-service
    restart: always
    ports:
      - "5005:5005"
    extra_hosts:
      - "host.docker.internal:host-gateway"
      - "win-hp03dio6fsk:192.168.0.165"
    environment:
      PORT: 5005
      DB_HOST: host.docker.internal
      DB_USER: user_inventory
      DB_PASSWORD: ${DB_PASSWORD}
      DB_NAME: new_inventory_service_db
      DB_PORT: 1433
      SAP_BASE_URL: ${SAP_BASE_URL}
      SAP_COMPANY_DB: ${SAP_COMPANY_DB}
      SAP_USERNAME: ${SAP_USERNAME}
      SAP_PASSWORD: ${SAP_PASSWORD}
      SAP_DB_HOST: ${SAP_DB_HOST}
      SAP_DB_USER: ${SAP_DB_USER}
      SAP_DB_PASSWORD: ${SAP_DB_PASSWORD}
      SAP_DB_NAME: ${SAP_DB_NAME}
      ENABLE_CRON: 1
      KAFKA_ENABLE: 1
      KAFKA_BROKER: kafka:9092
      KAFKA_CLIENT_ID: inventory-service
      KAFKA_GROUP_ID: inventory-service-po-events
      KAFKA_PO_TOPICS: sap.purchaseorder.cancelled
      KAFKA_FROM_BEGINNING: 1
      LOG_SAP: 1
    networks:
      - orders-service_kafka_network
```

---

## ▶️ Quick Start

```bash
# 1) Build & run
docker compose up -d --build
docker logs -f inventory-service

# 2) Health
curl http://localhost:5005/api/health

# 3) Crear un TT (traslado) de prueba
curl -X POST http://localhost:5005/api/inventory-docs \
 -H "Content-Type: application/json" \
 -d '{
  "header": { "docType":"TT", "fromWh":"01", "toWh":"07", "reference":"Traslado #789",
              "metaJson":{"user":"williams"}, "externalRef":"TT-789-20250908" },
  "lines":  [ { "itemSku":"001001001","quantity":3 }, { "itemSku":"001001002","quantity":5 } ],
  "enqueue": true
}'
```

---

## 🔌 Endpoints principales

Base: `http://localhost:5005/api`

### Stock
- `GET /stock/by-warehouse?sku=001001001&wh=01`
- `GET /stock/totals?sku=001001001`

### Movimientos (auditoría)
- `GET /movements?sku=&type=&wh=&status=&dateFrom=&dateTo=&page=1&pageSize=50`

### Documentos de Inventario (multi-línea)
- `POST /inventory-docs` (EM/SM/TT/EP)
- `GET /inventory-docs`
- `GET /inventory-docs/:id`

### Purchase Orders (PO)
- `GET /po/open-lines?poDocEntry=&docNum=&series=&sku=&wh=&vendorCode=&dateFrom=&dateTo=&page=1&pageSize=50`
- `GET /po/by-docentry/:docEntry`
- `GET /po/by-docnum/:docNum?series=`
- `POST /po/upsert`

### Integración (debug)
- `POST /integration/ep/dispatch`

---

## ⏱️ Cron jobs

- **SAP dispatcher** (`workers/cronRunner.js`): procesa `IntegrationQueue` (`status='PENDING'`) cada 1 minuto; lote `SAP_WORKER_BATCH`.
- **PO Sync (DB)**: consulta OC abiertas/actualizadas en SAP DB **posteriores** a `SyncState('PO_LAST_RUN') - 1 min`, upsert en `PurchaseOrders`/`PurchaseOrderLines`, y actualiza `SyncState`.

---

## 🧵 Kafka

- Consumer (`kafkajs`): grupo `KAFKA_GROUP_ID`.
- Tópicos: `KAFKA_PO_TOPICS` (o patrón `KAFKA_PO_TOPIC_PATTERN`).
- Evento soportado: **PurchaseOrder.Cancelled** (`objType=22`) → upsert PO con `docStatus='C'`, `cancelled=1`.

**Enviar un evento (dentro del contenedor kafka):**
```sh
echo '{"event":"PurchaseOrder.Cancelled","source":"SAPB1","objType":22,"docEntry":35795,"docNum":26297,"canceled":1,"supplier":{"code":"5555P","name":"MTS DISTRIBUCION"},"docDate":"2025-09-15","emittedAt":"2025-09-25T12:45:18.1460676","idempotencyKey":"B1-22-35795-CANCELLED"}' \
| /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic sap.purchaseorder.cancelled
```

---

## 🛠️ Troubleshooting

- **`Invalid session or session already timeout (301)`** → el worker reloga y reintenta; con `LOG_SAP=1` ves request/response.
- **`400` de Service Layer** → revisa `SapDocuments.payload` y `SapDocuments.responseJson`.
- **`One of the base documents has already been closed`** → la línea de OC ya está cerrada; ajusta `poDocEntry/poLineNum` o quita base.
- **Permisos SQL**: “EXECUTE denied” o “Invalid object name” → aplicar **GRANT** y validar esquema/BD.
- **Kafka**: sin mensajes → confirmar `KAFKA_ENABLE=1`, tópicos, red y `KAFKA_LOG_MSG=1`.

---

## ✅ Checklist de despliegue

1. Configurar `.env` (DB inventario, SAP SL, SAP DB, Kafka, cron).
2. Ejecutar scripts de **tablas, TVP y SPs** (incluye `apply_inventory_document`, `upsert_purchase_order`).
3. Conceder **permisos** (GRANT) al usuario de la app.
4. Construir e iniciar: `docker compose up -d --build`.
5. Ver `logs` de arranque, healthcheck y suscripción Kafka (si aplica).
6. Probar un documento **EM/SM/TT** y validar ajustes en `ItemWarehouseStock`.
7. Probar **EP por OC** y confirmar publicación en SAP (y snapshot en `SapDocuments`).
8. Activar **PO Sync** y validar upsert de OC y su actualización por eventos Kafka.
9. Configurar monitoreo (métricas/alertas) sobre `IntegrationQueue` y errores SL.

---

## 🧭 Notas de diseño

- Este MS es **autónomo**: evita dependencias síncronas del MS de catálogo.
- Si terceros requieren SQL directo, publica una **vista contrato** (p. ej. `vw_StockByWarehouse`) para estabilidad/seguridad.
- Para alto QPS, considera **columnas computadas PERSISTED** e índices sobre `ItemWarehouseStock`.

---

> Mantén `mapSkuToItemCode()` en `sapWorker.js` si SKU ≠ ItemCode en SAP B1.

