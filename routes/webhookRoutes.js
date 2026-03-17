// backend/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();

// Controladores
const muxWebhookController = require('../controllers/muxWebhookController'); // 🔥 CEREBRO DE STREAMING (Mux)

/**
 * 📢 NOTA DEL SISTEMA:
 * Se eliminó el webhook de NOWPayments. 
 * El motor financiero ahora es PayRam y procesa todo en tiempo real 
 * desde 'paymentRoutes.js'.
 */

// ==========================================
// 🎥 WEBHOOKS DE VIDEO Y STREAMING (Mux)
// ==========================================
// 📡 RUTA: La antena de automatización de Mux.
// Mux nos avisa cuando un Creador inicia o termina un Live Stream.
router.post('/mux', express.json(), muxWebhookController.handleMuxWebhook);

module.exports = router;