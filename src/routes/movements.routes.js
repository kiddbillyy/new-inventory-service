const express = require('express');
const { postMovement, getMovements } = require('../controllers/movementController');
const r = express.Router();

r.post('/movements', postMovement);
r.get('/movements', getMovements);

module.exports = r;
