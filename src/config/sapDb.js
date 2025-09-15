// src/config/sapDb.js
const sql = require('mssql');

let pool;
async function getSapPool() {
  if (pool && pool.connected) return pool;
  pool = await new sql.ConnectionPool({
    server:   process.env.SAP_DB_HOST,
    user:     process.env.SAP_USERNAMEBD,
    password: process.env.SAP_PASSWORDBD,
    database: process.env.SAP_COMPANY_DB,
    options:  { encrypt: false, trustServerCertificate: true }
  }).connect();
  return pool;
}

module.exports = { getSapPool, sql };
