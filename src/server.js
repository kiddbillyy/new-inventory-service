const express = require('express');
const { port, serviceName } = require('./config/env');

const health = require('./routes/health.routes');
const movements = require('./routes/movements.routes');
const stock = require('./routes/stock.routes');
const po = require('./routes/po.routes');
const invDocsRoutes = require('./routes/inventoryDocs.routes');
const integrationRoutes = require('./routes/integration.routes');


const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', health, movements, stock, po,invDocsRoutes,integrationRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not Found' }));

app.listen(port, () => console.log(`🚀 ${serviceName} listening on :${port}`));
