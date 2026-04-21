// backend/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();

// Controladores
const muxWebhookController = require('../controllers/muxWebhookController'); // 🔥 CEREBRO DE STREAMING (Mux)
const webhookController = require('../controllers/webhookController'); // 💰 RADAR FINANCIERO (PayRam)

/**
 * 📢 NOTA DEL SISTEMA (ACTUALIZADA):
 * El motor financiero ahora es PayRam. 
 * Los movimientos internos (suscripciones, PPV) ocurren en 'paymentController.js'.
 * Este archivo (webhookRoutes) se encarga exclusivamente de escuchar cuando 
 * el procesador externo (tarjeta de crédito/cripto) confirma que el Fan ya pagó.
 */

// ==========================================
// 💰 WEBHOOK FINANCIERO (PayRam)
// ==========================================
// 📡 RUTA: El radar que inyecta dólares a la bóveda del Fan tras pagar con tarjeta
router.post('/payram', express.json(), webhookController.handlePayRamWebhook);


// ==========================================
// 🎥 WEBHOOKS DE VIDEO Y STREAMING (Mux)
// ==========================================
// 📡 RUTA: La antena de automatización de Mux.
// Mux nos avisa cuando un Creador inicia o termina un Live Stream.
router.post('/mux', express.json(), muxWebhookController.handleMuxWebhook);

module.exports = router;