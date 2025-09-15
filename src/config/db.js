const sql = require('mssql');
const { db } = require('./env');

let pool;
async function getPool() {
  if (pool?.connected) return pool;

  if (!db.server) throw new Error('DB_SERVER/DB_HOST missing');
  if (!db.password) throw new Error('DB_PASSWORD missing');

  pool = await sql.connect({
    server: db.server,
    port: db.port,                 // <-- importante para 1433
    user: db.user,
    password: db.password,
    database: db.database,
    options: db.options,           // { encrypt, trustServerCertificate }
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 }
  });
  return pool;
}
module.exports = { getPool, sql };
