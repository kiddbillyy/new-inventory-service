# 📦 Inventory Service — Mimbral OMS Integration

**Versión:** 1.0.0
**Stack:** Node.js 18 · Express · SQL Server 2019 · KafkaJS · SAP B1 Service Layer · Docker Compose
**Autor:** Williams Mejías / Mimbral IT

---

## 🧭 Propósito

Microservicio encargado de la **gestión de inventarios** y **movimientos de stock** dentro del ecosistema Mimbral OMS. Sincroniza información entre SAP Business One, VTEX y los sistemas internos mediante eventos Kafka, integración REST y procedimientos almacenados SQL Server.

Funciones principales:

* Registrar y aplicar **movimientos de stock** (entradas, salidas, transferencias, recepciones de compra).
* Mantener una **cola de integración (IntegrationQueue)** para enviar documentos a SAP B1.
* Escuchar **eventos Kafka** (por ejemplo, `sap.purchaseorder.cancelled`) para actualizar el estado local.
* Sincronizar periódicamente **órdenes de compra abiertas** desde SAP (`OPOR` → `PurchaseOrders`).
* Exponer API REST para consultar stock, movimientos y documentos de inventario.
* Generar snapshots en `SapDocuments` para trazabilidad completa.

---

## ⚙️ Estructura de carpetas

```
/src
├── config/           # Configuración de DB, SAP, Kafka, entorno
├── controllers/      # Controladores HTTP
├── models/           # Acceso directo a la BD (mssql)
├── routes/           # Endpoints Express agrupados
├── services/         # Lógica de negocio y validaciones
├── kafka/            # Consumers de eventos SAP/VTEX
├── producer/         # Productores Kafka
├── workers/          # Cron jobs y workers de integración SAP
├── jobs/             # Scripts autónomos (batch / polling)
└── server.js         # Entry point principal del microservicio
```

---

## 🌐 Endpoints principales (REST API)

| Método | Ruta                                  | Descripción                                  |
| ------ | ------------------------------------- | -------------------------------------------- |
| `GET`  | `/api/health`                         | Verifica estado del servicio                 |
| `GET`  | `/api/ready`                          | Confirma si está listo para tráfico          |
| `GET`  | `/api/version`                        | Versión del microservicio                    |
| `POST` | `/api/movements`                      | Registra un movimiento (usa `applyMovement`) |
| `GET`  | `/api/movements`                      | Lista movimientos registrados                |
| `GET`  | `/api/stock/by-warehouse`             | Consulta stock por SKU y almacén             |
| `POST` | `/api/po/upsert`                      | Inserta/actualiza una orden de compra local  |
| `GET`  | `/api/po/open-lines`                  | Lista líneas abiertas de OC                  |
| `GET`  | `/api/po/:docEntry`                   | Detalle por DocEntry                         |
| `POST` | `/api/integration/dispatch`           | Despacha lote de documentos a SAP            |
| `GET`  | `/api/integration/sap-payload/:docId` | Previsualiza payload SAP SL antes del envío  |

---

## 🧩 Integraciones principales

### 🔁 SAP Business One (Service Layer)

* Autenticación vía `/Login` con sesión persistente (`B1SESSION`).
* Builders dedicados: `buildOPDN`, `buildOIGN`, `buildOIGE`, `buildOWTR`.
* Función central `dispatchBatch()` en `sapWorker.js` que recorre `IntegrationQueue` y postea docs pendientes.
* Guardado de snapshots (payload + respuesta) en `SapDocuments`.

### 🔊 Kafka

* Usa **kafkajs**.
* Consumer: `poEventsConsumer.js` escucha `sap.purchaseorder.cancelled`.
* Producer: `producer/index.js` (helper genérico para emitir eventos outbox).
* Idempotencia gestionada vía tabla `EventInbox` y columna `idempotencyKey`.

### 🕓 Cron / Jobs

* `cronRunner.js` ejecuta:

  * `dispatchBatch()` cada 1 minuto (envío SAP).
  * `syncOpenPOsFromDB()` cada 5 minutos (sincronización OC SAP).
* `sapPOFetcherDirect.js` implementa el polling de SAP (`OPOR` + `POR1`) por `UpdateDate/Time` con cursor incremental (`SyncState`).

---

## 🗃️ Esquema de Base de Datos (SQL Server)

### Tablas Core

| Tabla                    | Descripción                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `InventoryDocuments`     | Cabecera de documentos de inventario (EP, EM, SM, TT).                   |
| `InventoryDocumentLines` | Líneas asociadas a cada documento.                                       |
| `StockMovements`         | Movimientos básicos aplicados vía SP `apply_movement`.                   |
| `IntegrationQueue`       | Cola de integración con SAP; se alimenta desde `enqueueIntegrationDB()`. |
| `SapDocuments`           | Snapshot de payloads enviados a SAP.                                     |
| `EventInbox`             | Control de idempotencia Kafka.                                           |
| `ProcessedEvents`        | Auditoría de eventos ya procesados.                                      |

### Sincronización OC SAP

| Tabla / Vista               | Descripción                                    |
| --------------------------- | ---------------------------------------------- |
| `PurchaseOrders`            | Cabecera de órdenes de compra locales.         |
| `PurchaseOrderLines`        | Líneas asociadas a cada orden.                 |
| `vw_PurchaseOrderOpenLines` | Vista auxiliar de líneas abiertas.             |
| `SyncState`                 | Guarda cursores (timestamp o UpdateDate/Time). |
| `SyncCheckpoints`           | Controla último estado procesado por entidad.  |

### Catálogos y Stock

| Objeto                 | Descripción                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Items` / `Warehouses` | Catálogos de ítems y almacenes.                                                                                              |
| `ItemWarehouseStock`   | Niveles por SKU/almacén. Campos: `onHandQty`, `salesCommitQty`, `purchaseOrdQty`, `blocked`, `safetyStock`, `infiniteStock`. |
| `vw_StockByWarehouse`  | Vista principal para `/api/stock/by-warehouse`.                                                                              |
| `vw_StockTotals`       | Totales por SKU.                                                                                                             |

### Procedimientos y TVP

| Tipo | Nombre                      | Uso                                                       |
| ---- | --------------------------- | --------------------------------------------------------- |
| SP   | `apply_movement`            | Registra movimientos de inventario.                       |
| SP   | `enqueue_integration`       | Encola doc en `IntegrationQueue`.                         |
| SP   | `upsert_purchase_order`     | Inserta/actualiza OC y líneas.                            |
| SP   | `list_movements`            | Lista movimientos con filtros/paginación.                 |
| TVP  | `PurchaseOrderLineType`     | TVP usado en `poModel.js` para insertar múltiples líneas. |
| TVP  | `InventoryDocumentLineType` | TVP para líneas de inventario (opcional según versión).   |

### Relaciones principales

```
InventoryDocuments 1─∞ InventoryDocumentLines
InventoryDocuments 1─∞ IntegrationQueue
IntegrationQueue 1─1 SapDocuments
PurchaseOrders 1─∞ PurchaseOrderLines
```

---

## 🔒 Idempotencia y Trazabilidad

* **Kafka**: `EventInbox` evita reprocesar el mismo evento `idempotencyKey`.
* **SAP**: cada envío queda registrado en `SapDocuments`.
* **Movimientos**: SP `apply_movement` garantiza atomicidad y validación (`type`, `quantity > 0`).
* **OC Sync**: `SyncState` persiste cursores `DATE`/`TIME` para continuar donde quedó el polling.

---

## 🧠 Variables de entorno (.env)

```env
PORT=5005
DB_HOST=host.docker.internal
DB_USER=user_inventory
DB_PASSWORD=Mimbral1579
DB_NAME=new_inventory_service_db
DB_PORT=1433
SAP_DB_HOST=192.168.0.24
SAP_DB_USER=user_inventory
SAP_DB_PASSWORD=Mimbral_!234
SAP_DB_NAME=COMERCIAL_CIERRE_TEST
KAFKA_ENABLE=1
KAFKA_BROKER=kafka:9092
KAFKA_CLIENT_ID=inventory-service
KAFKA_GROUP_ID=inventory-service-po-events
KAFKA_PO_TOPICS=sap.purchaseorder.cancelled
KAFKA_FROM_BEGINNING=1
ENABLE_CRON=1
LOG_SAP=1
SAP_BASE_URL=https://win-hp03dio6fsk:50000/b1s/v1
SAP_COMPANY_DB=COMERCIAL_CIERRE_TEST
SAP_USERNAME=manager
SAP_PASSWORD=mngr
```

---

## 🐳 Docker & Despliegue

### docker-compose.yml

```yaml
version: '3.8'
services:
  inventory-service:
    build: .
    ports:
      - "5005:5005"
    networks:
      - orders-service_kafka_network
    environment:
      LOG_SAP: "1"
      ENABLE_CRON: "1"
  inventory-worker:
    build: .
    command: ["node","src/workers/cronRunner.js"]
    networks:
      - orders-service_kafka_network
```

### Dockerfile

```dockerfile
FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5005
CMD ["npm", "start"]
```

---

## 🧾 Scripts npm

| Script                    | Descripción                                 |
| ------------------------- | ------------------------------------------- |
| `npm start`               | Inicia el servidor Express principal.       |
| `npm run consumer`        | Ejecuta consumer Kafka manualmente.         |
| `npm run job:integration` | Worker de integración SAP.                  |
| `npm run job:sapSync`     | Sincronización manual de órdenes de compra. |

---

## 🧱 Orden de despliegue BD (recomendado)

1. Crear TVP (`PurchaseOrderLineType`, `InventoryDocumentLineType`).
2. Crear tablas base (`InventoryDocuments`, `IntegrationQueue`, etc.).
3. Crear vistas (`vw_StockByWarehouse`, `vw_PurchaseOrderOpenLines`).
4. Crear SP (`apply_movement`, `upsert_purchase_order`, etc.).
5. Insertar configuraciones iniciales en `SyncState`, `Warehouses`, `Items`.

Ejemplo con `sqlcmd`:

```bash
sqlcmd -S localhost -d new_inventory_service_db -U sa -P 4951sF67l -i schema.sql
```

---

## 📊 Logs y monitoreo

* **SAP**: controlado por `LOG_SAP=1` → imprime payloads y respuestas SL.
* **Kafka**: logs detallados con `KAFKA_LOG_MSG=1`.
* **Cron**: registro automático en stdout cada minuto.

---

## ✅ Estado y monitoreo

* Healthcheck: `GET /api/health` → `{ ok: true }`.
* Ready: `GET /api/ready` → `{ ok: true }`.
* Version: `GET /api/version` → `{ version: '1.0.0' }`.

---

## 🧩 Resumen general de flujo

```mermaid
flowchart TD
    A[Kafka: sap.purchaseorder.cancelled] -->|Consumer| B[poEventsConsumer]
    B -->|Upsert OC cancelada| C[poService.upsertPO]
    C -->|Actualiza BD| D[(PurchaseOrders)]

    E[Movimiento REST /movements] -->|Controller| F[applyMovementDB]
    F -->|SP apply_movement| G[(StockMovements)]
    G -->|Encola si EM/SM/TT/EP| H[(IntegrationQueue)]

    I[CronRunner] -->|Cada 1 min| J[sapWorker.dispatchBatch]
    J -->|POST SL| K[SAP Business One]
    K -->|Respuesta| L[(SapDocuments)]

    M[CronRunner] -->|Cada 5 min| N[sapPOFetcherDirect]
    N -->|Polling SAP OPOR/POR1| D[(PurchaseOrders)]
```

---

## 🧰 Recomendaciones

* Activar `LOG_SAP` solo en entornos de QA.
* Revisar certificados si SAP usa HTTPS interno.
* Asegurar sincronía entre TZ de SAP y Node (`SAP_TZ_OFFSET_MINUTES`).
* Limpiar `IntegrationQueue` periódicamente (mantener últimos 90 días).

---

## 📚 Créditos

Desarrollado por **Williams Mejías**
Integración entre SAP Business One 10.0 y Mimbral OMS
© Sociedad Comercial El Mimbral Ltda.

---

## 🧱 Arquitectura Lógica

```mermaid
flowchart LR
  subgraph ClientApps[Apps clientes]
    UI[OMS / Backoffice / Integraciones]
  end

  UI -->|REST| API[Inventory Service (Express)]
  API --> Ctrls[Controllers]
  Ctrls --> Svcs[Services]
  Svcs --> Models[Models]

  Models --> SQL[(SQL Server
new_inventory_service_db)]
  Svcs --> KFK[(Kafka Broker)]
  Svcs --> SAPSL[(SAP B1
Service Layer)]
  Svcs --> VTEX[(VTEX API)]

  subgraph Workers[Workers & Cron]
    CRON[cronRunner.js]
    W1[sapWorker.dispatchBatch]
    W2[sapPOFetcherDirect]
  end

  CRON --> W1
  CRON --> W2
  W1 -->|POST OPDN/OIGN/OIGE/OWTR| SAPSL
  W2 --> SAPDB[(SAP DB
OPOR/POR1)]

  KFK -->|sap.purchaseorder.cancelled| CONSUMER[poEventsConsumer]
  CONSUMER --> INBOX[(EventInbox /
ProcessedEvents)]

  W1 --> SNAP[(SapDocuments
Snapshots)]
```

---

## 🧩 Arquitectura Física / Despliegue

```mermaid
flowchart TB
  subgraph Host[Host / VM]
    subgraph Docker[Docker Engine]
      subgraph Compose[docker-compose]
        SVC[inventory-service
(Express API)]
        WRK[inventory-worker
(cronRunner)]
      end
    end
  end

  NET[(orders-service_kafka_network)]
  SVC --- NET
  WRK --- NET

  KAFKA[(Kafka Cluster)] --- NET

  DBINV[(SQL Server
new_inventory_service_db)]
  SVC <---> DBINV
  WRK <---> DBINV

  SAPSL[(SAP Service Layer
https://win-hp03dio6fsk:50000/b1s/v1)]
  SVC <---> SAPSL
  WRK <---> SAPSL

  SAPDB[(SQL Server SAP
OPOR/POR1)]
  WRK <---> SAPDB

  VTEX[(VTEX SaaS)] --- SVC

  note right of SVC: Expuesto en :5005 (HTTP)
  note left of DBINV: Credenciales DB_* (.env)
```

---

## 🔄 Secuencia — EP (Entrada por Compra)

```mermaid
sequenceDiagram
  participant Client as Cliente
  participant API as Inventory Service (API)
  participant DB as SQL Server (Inventario)
  participant Q as IntegrationQueue
  participant Cron as cronRunner/sapWorker
  participant SAP as SAP B1 Service Layer

  Client->>API: POST /api/inventory-docs { docType: "EP", lines: [...] }
  API->>DB: SP dbo.apply_inventory_document(lines TVP, enqueue=1)
  DB-->>API: { documentId, status, movementIdsJson }
  API-->>Client: 201 Created { ok:true, documentId }

  Cron->>DB: SELECT PENDING FROM IntegrationQueue
  Cron->>SAP: POST /PurchaseDeliveryNotes (OPDN payload)
  SAP-->>Cron: 201 { DocEntry, DocNum }
  Cron->>DB: UPDATE InventoryDocuments SET POSTED + snapshot en SapDocuments
```

---

# 🧬 Secuencias completas (teoría de punta a punta)

> A continuación se describen **todas las secuencias funcionales** del microservicio, en términos teóricos, para entender el flujo end‑to‑end entre API, BD, colas de integración, cron workers, SAP B1 (Service Layer y DB), y Kafka.

## 1) Crear Documento de Inventario (capa API) → `EP|EM|SM|TT`

```mermaid
sequenceDiagram
  autonumber
  participant Client as Cliente/OMS
  participant API as API (Express)
  participant Ctrls as Controllers
  participant Svc as Services
  participant Model as Models (mssql)
  participant SQL as SQL Server (Inventario)

  Client->>API: POST /api/inventory-docs {header, lines, docType}
  API->>Ctrls: createInventoryDocCtrl(req)
  Ctrls->>Svc: validar header/lines + normalizar docType
  Svc->>Model: createInventoryDocDB(header, lines, enqueue)
  Model->>SQL: EXEC dbo.apply_inventory_document(...,@linesTVP, @enqueue)
  SQL-->>Model: {documentId, status, movementIdsJson}
  Model-->>Svc: idem
  Svc-->>Ctrls: idem
  Ctrls-->>Client: 201 { ok:true, documentId, status }
```

## 2) Aplicar Movimiento simple (sin documento) → `/api/movements`

```mermaid
sequenceDiagram
  autonumber
  participant Client as Cliente/OMS
  participant API as API
  participant Ctrls as Controllers
  participant Svc as Services
  participant Model as movementModel
  participant SQL as SQL Server

  Client->>API: POST /api/movements { type, sku, fromWh, toWh, qty }
  API->>Ctrls: postMovement
  Ctrls->>Svc: applyMovement(payload, enqueue?)
  Svc->>Model: applyMovementDB(payload)
  Model->>SQL: EXEC dbo.apply_movement(...)
  SQL-->>Model: movementId (o select TOP 1 fallback)
  Model-->>Svc: movementId
  Svc->>Model: enqueueIntegrationDB(movementId) (si EM/SM/TT/EP y enqueue=true)
  Model->>SQL: EXEC dbo.enqueue_integration(movementId)
  SQL-->>Model: ok
  Svc-->>Ctrls: { movementId, type }
  Ctrls-->>Client: 201 { ok:true, movementId }
```

## 3) Despacho a SAP (cron) — `dispatchBatch()`

```mermaid
sequenceDiagram
  autonumber
  participant Cron as cronRunner
  participant Worker as sapWorker
  participant SQL as SQL Server
  participant SL as SAP Service Layer

  Cron->>Worker: dispatchBatch(BATCH_SIZE) cada 1 min
  Worker->>SQL: SELECT PENDING FROM IntegrationQueue JOIN InventoryDocuments
  loop por cada fila
    Worker->>SQL: SELECT header+lines de InventoryDocuments/Lines
    alt Tipo EP/EM/SM/TT
      Worker->>SL: POST /OPDN | /OIGN | /OIGE | /StockTransfers (payload)
    end
    SL-->>Worker: 201 { DocEntry, DocNum }
    Worker->>SQL: UPDATE InventoryDocuments (POSTED, sapDocEntry, sapDocNum)
    Worker->>SQL: INSERT SapDocuments (snapshot request/response)
    Worker->>SQL: UPDATE IntegrationQueue SET DONE
  end
  Worker-->>Cron: { processed, ok, fail }
```

## 4) Previsualizar payload SAP (sin enviar)

```mermaid
sequenceDiagram
  autonumber
  participant Client as Cliente
  participant API as API
  participant Routes as integration.routes
  participant SQL as SQL Server
  participant Builders as buildOPDN/OIGN/OIGE/OWTR

  Client->>API: GET /api/integration/sap-payload/:docId
  API->>Routes: loadDoc(docId)
  Routes->>SQL: SELECT header+lines
  SQL-->>Routes: datos del documento
  Routes->>Builders: build según header.docType
  Builders-->>Routes: { path, body }
  Routes-->>Client: 200 { path, body }
```

## 5) Sincronización OC desde SAP DB (`OPOR`/`POR1`) — `sapPOFetcherDirect`

```mermaid
sequenceDiagram
  autonumber
  participant Cron as cronRunner (cada 1-5 min)
  participant Fetcher as sapPOFetcherDirect
  participant INVDB as SQL Inventario (SyncState)
  participant SAPDB as SQL SAP (OPOR/POR1)
  participant POModel as poModel

  Cron->>Fetcher: syncOpenPOsFromDB()
  Fetcher->>INVDB: leer cursor (SyncState.updatedAt o value.ts)
  Fetcher->>SAPDB: SELECT OPOR changed > cursor (TOP BATCH)
  loop por cada PO
    Fetcher->>SAPDB: SELECT POR1 lines by DocEntry
    Fetcher->>POModel: upsertPO(header, lines)
    POModel->>INVDB: EXEC dbo.upsert_purchase_order(@linesTVP)
  end
  Fetcher->>INVDB: setLastCursorNow()
  Fetcher-->>Cron: { usedFrom, fetched, upserts }
```

## 6) Evento Kafka — OC Cancelada (`sap.purchaseorder.cancelled`)

```mermaid
sequenceDiagram
  autonumber
  participant Kafka as Kafka Topic
  participant Consumer as poEventsConsumer
  participant Inbox as EventInbox
  participant POService as poService
  participant INVDB as SQL Inventario

  Kafka-->>Consumer: mensaje { event: PurchaseOrder.Cancelled, objType:22, docEntry }
  Consumer->>Inbox: recordEvent(idempotencyKey)
  alt ya procesado y DONE
    Inbox-->>Consumer: inserted=false, status=DONE (salta)
  else nuevo/pendiente
    Consumer->>POService: upsertPO(header cancelado, [])
    POService->>INVDB: EXEC dbo.upsert_purchase_order(cancelled=1)
    POService-->>Consumer: ok
    Consumer->>Inbox: markEventDone()
  end
```

## 7) Consultas HTTP — Stock por bodega

```mermaid
sequenceDiagram
  autonumber
  participant Client as Cliente
  participant API as API
  participant Ctrl as stockController
  participant Svc as stockService
  participant Model as stockModel
  participant SQL as SQL Server

  Client->>API: GET /api/stock/by-warehouse?sku=...&warehouseCode=...
  API->>Ctrl: getStockByWarehouseCtrl
  Ctrl->>Svc: getStockByWarehouse(q)
  Svc->>Model: getStockByWarehouseDB(q)
  Model->>SQL: SELECT desde vista/tablas (ItemWarehouseStock, etc.)
  SQL-->>Model: rows
  Model-->>Svc: rows
  Svc-->>Ctrl: rows
  Ctrl-->>Client: 200 { rows }
```

## 8) Consultas HTTP — Listado de movimientos

```mermaid
sequenceDiagram
  autonumber
  participant Client as Cliente
  participant API as API
  participant Ctrl as movementController
  participant Model as movementModel
  participant SQL as SQL Server

  Client->>API: GET /api/movements?sku=&type=&wh=&status=&dateFrom=&dateTo=&page=
  API->>Ctrl: getMovements
  Ctrl->>Model: listMovementsDB(q)
  Model->>SQL: EXEC dbo.list_movements(...)
  SQL-->>Model: { rows, Total }
  Model-->>Ctrl: idem
  Ctrl-->>Client: 200 { rows, total }
```

## 9) Ciclo de vida del servidor y cron/consumer

```mermaid
sequenceDiagram
  autonumber
  participant OS as Sistema/Container
  participant Node as Node.js process
  participant Server as server.js
  participant Cron as cronRunner
  participant Kafka as poEventsConsumer

  OS->>Node: iniciar contenedor (CMD npm start)
  Node->>Server: cargar Express + rutas
  Server-->>OS: listening :PORT
  alt ENABLE_CRON != '0'
    Server->>Cron: require('./workers/cronRunner')
    Cron-->>Server: tareas agendadas
  end
  alt KAFKA_ENABLE == '1'
    Server->>Kafka: startPoEventsConsumer()
    Kafka-->>Server: conectado
  end
  OS-->>Server: SIGTERM/SIGINT
  Server->>Kafka: disconnect()
  Server-->>OS: server.close() & exit(0)
```

## 10) Errores SAP y reintento automático

```mermaid
sequenceDiagram
  autonumber
  participant Worker as sapWorker.slPost
  participant SL as SAP Service Layer
  participant Q as IntegrationQueue
  participant Snap as SapDocuments

  Worker->>SL: POST recurso SL (con Cookie B1SESSION)
  alt Sesión válida
    SL-->>Worker: 201 OK
    Worker->>Q: UPDATE DONE
    Worker->>Snap: snapshot(payload, resp)
  else Sesión inválida/401/301
    SL-->>Worker: error { code:301 | 401, msg:"invalid session" }
    Worker->>Worker: logout() + login()  (retry)
    Worker->>SL: POST nuevamente
    alt éxito en retry
      SL-->>Worker: 201 OK
      Worker->>Q: UPDATE DONE
      Worker->>Snap: snapshot
    else sigue fallando
      SL-->>Worker: error
      Worker->>Q: UPDATE FAILED + errorMsg
      Worker->>Snap: snapshot(error)
    end
  end
```

---

> Estas secuencias cubren **creación/aplicación**, **despacho a SAP**, **sincronización de OC**, **consumo de eventos Kafka**, y **consultas**. Si necesitas profundizar en un flujo específico (p.ej. **Transferencias TT** con validación de `fromWh/toWh` a nivel línea), lo detallamos con reglas de validación adicionales y ejemplos de payload.
