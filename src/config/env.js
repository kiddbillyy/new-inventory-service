// CommonJS
require('dotenv').config();

function asList(s) { return String(s || '').split(',').map(x => x.trim()).filter(Boolean); }

module.exports = {
  port: parseInt(process.env.PORT || '8080', 10),
  serviceName: process.env.SERVICE_NAME || 'inventory-service',

  db: {
    // acepta DB_SERVER o DB_HOST
    server: process.env.DB_SERVER || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD,
    // acepta DB_DATABASE o DB_NAME
    database: process.env.DB_DATABASE || process.env.DB_NAME || 'new_inventory_service_db',
    options: {
      encrypt: (process.env.DB_ENCRYPT || 'false') === 'true',
      trustServerCertificate: true
    }
  },

  kafka: {
    // acepta KAFKA_BROKERS (lista) o KAFKA_BROKER (único)
    brokers: asList(process.env.KAFKA_BROKERS || process.env.KAFKA_BROKER || 'kafka:9092'),
    clientId: process.env.KAFKA_CLIENT_ID || 'inventory-service',
    groupId: process.env.KAFKA_GROUP_ID || 'inventory-consumer',
    topicIn: process.env.KAFKA_TOPIC_IN || 'inventory.events.in',
    topicOut: process.env.KAFKA_TOPIC_OUT || 'inventory.events.out'
  },

  sap: {
    baseUrl: process.env.SAP_BASE_URL,
    companyDb: process.env.SAP_COMPANY_DB,
    // acepta SAP_USER o SAP_USERNAME
    user: process.env.SAP_USER || process.env.SAP_USERNAME,
    password: process.env.SAP_PASSWORD,
    timeout: parseInt(process.env.SAP_TIMEOUT_MS || '20000', 10)
  }
};
