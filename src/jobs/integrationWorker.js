const { getPool, sql } = require('../config/db');
// const { post } = require('../services/sapService');  // cuando lo conectes

(async function run() {
  console.log('[worker] integration started');
  const pool = await getPool();
  setInterval(async () => {
    const { recordset: rows } = await pool.request().query(`
      SELECT TOP 20 id, movementId, type
      FROM dbo.IntegrationQueue
      WHERE status IN ('PENDING','RETRY') AND (nextRunAt IS NULL OR nextRunAt <= SYSDATETIME())
      ORDER BY id ASC
    `);
    for (const q of rows) {
      try {
        await pool.request().input('id', sql.BigInt, q.id)
          .query(`UPDATE dbo.IntegrationQueue SET status='SENDING', attempts=attempts+1, updatedAt=SYSDATETIME() WHERE id=@id`);
        // const sapResp = await post('/InventoryPostPath', { ... });
        await pool.request().input('id', sql.BigInt, q.id)
          .query(`UPDATE dbo.IntegrationQueue SET status='SUCCESS', updatedAt=SYSDATETIME() WHERE id=@id`);
      } catch (err) {
        await pool.request().input('id', sql.BigInt, q.id)
          .query(`UPDATE dbo.IntegrationQueue SET status='RETRY', nextRunAt=DATEADD(MINUTE,5,SYSDATETIME()), updatedAt=SYSDATETIME() WHERE id=@id`);
      }
    }
  }, 3000);
})();
