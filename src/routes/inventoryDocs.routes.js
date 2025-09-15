// src/routes/inventoryDocs.routes.js
const express = require('express');
const { createInventoryDocCtrl, getInventoryDocCtrl, listInventoryDocsCtrl } = require('../controllers/inventoryDocController');

const r = express.Router();

r.post('/inventory-docs', createInventoryDocCtrl);     // crear documento (cabecera + líneas)
r.get('/inventory-docs', listInventoryDocsCtrl);       // listar documentos (filtros/paginación)
r.get('/inventory-docs/:id', getInventoryDocCtrl);     // obtener documento por id

module.exports = r;
