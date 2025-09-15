const express = require('express');
const r = express.Router();
r.get('/health', (_req, res) => res.json({ ok: true }));
r.get('/ready',  (_req, res) => res.json({ ok: true }));
r.get('/version', (_req, res) => res.json({ version: '1.0.0' }));
module.exports = r;
