// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');
const webhookController = require('../controllers/webhookController');

// ==========================================
// 💳 RUTAS FINANCIERAS (Híbridas Cripto-Fiat)
// ==========================================

/**
 * Generador Maestro de Órdenes (Suscripciones, PPV, Tips, Bundles)
 * Esta única ruta gestiona la creación de cualquier tipo de intención de pago.
 */
router.post('/create-intent', verifyToken, paymentController.createPaymentIntent);

// ==========================================
// 🔁 RUTAS DE CONTROL DE SUSCRIPCIONES
// ==========================================
router.get('/my-subscriptions', verifyToken, paymentController.getMySubscriptions);
router.post('/cancel-subscription', verifyToken, paymentController.cancelSubscription);

// ==========================================
// 📡 WEBHOOK GLOBAL (El Cerebro Activador)
// ==========================================
/**
 * RUTA PÚBLICA PARA EL WEBHOOK DE NOWPAYMENTS
 * Importante: No lleva verifyToken porque lo llama el servidor de la pasarela.
 * Se usa 'handleNowPaymentsWebhook' que es el nombre exportado en tu controlador.
 */
router.post('/webhook', webhookController.handleNowPaymentsWebhook);

module.exports = router;