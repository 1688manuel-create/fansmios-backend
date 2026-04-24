const express = require('express');
const router = express.Router();
const { confirmarDePay } = require('../controllers/depayController'); // Asegúrate de que la ruta sea correcta

// Ruta completa: POST /api/depay/confirmar
router.post('/confirmar', confirmarDePay);

module.exports = router;