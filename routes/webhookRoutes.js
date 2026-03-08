// backend/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();

// Controladores
const webhookController = require('../controllers/webhookController');
const muxWebhookController = require('../controllers/muxWebhookController'); // 🔥 IMPORTAMOS EL CEREBRO DE MUX

// ==========================================
// 💰 WEBHOOKS FINANCIEROS (FASES 2 & 3)
// ==========================================
// 📡 RUTA: La antena secreta descentralizada (NOWPayments)
// Nota: NOWPayments usa JSON normal, no necesitamos el express.raw() que exigía Stripe.
router.post('/nowpayments', express.json(), webhookController.handleNowPaymentsWebhook);


// ==========================================
// 🎥 WEBHOOKS DE VIDEO Y STREAMING (FASE 5)
// ==========================================
// 📡 RUTA: La antena de automatización de Mux
// Mux nos enviará un JSON cada vez que el creador encienda o apague el OBS.
router.post('/mux', express.json(), muxWebhookController.handleMuxWebhook);

module.exports = router;