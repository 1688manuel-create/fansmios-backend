// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

// ==========================================
// 💳 NÚCLEO FINANCIERO FANSMIOS (Motor Interno Covra)
// ==========================================

/**
 * Generador Maestro de Órdenes Internas (Suscripciones, PPV, Tips, Bundles)
 * Esta es la ruta central que dispara el motor interno de Fansmios.
 * Procesa los pagos y transfiere el saldo entre usuarios de forma instantánea.
 * (🔥 Las recargas de dinero externo ahora viajan vía Web3 por /api/depay)
 */
router.post('/create-intent', verifyToken, paymentController.createPaymentIntent);

// ==========================================
// 🔁 GESTIÓN DE SUSCRIPCIONES Y ACTIVOS
// ==========================================

/**
 * Obtener el historial de suscripciones activas del Fan.
 */
router.get('/my-subscriptions', verifyToken, paymentController.getMySubscriptions);

/**
 * Cancelar la renovación de una suscripción activa.
 */
router.post('/cancel-subscription', verifyToken, paymentController.cancelSubscription);

module.exports = router;