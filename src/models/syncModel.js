const { getPool, sql } = require('../config/db');

async function getCheckpoint(entity) {
  const pool = await getPool();
  const { recordset } = await pool.request().input('entity', sql.NVarChar(50), entity).execute('dbo.get_checkpoint');
  return recordset?.[0];
}
async function saveCheckpoint(entity, d, t, e) {
  const pool = await getPool();
  await pool.request()
    .input('entity', sql.NVarChar(50), entity)
    .input('lastUpdateDate', sql.Date, d)
    .input('lastUpdateTime', sql.Int, t)
    .input('lastDocEntry', sql.Int, e)
    .execute('dbo.save_checkpoint');
}

module.exports = { getCheckpoint, saveCheckpoint };
