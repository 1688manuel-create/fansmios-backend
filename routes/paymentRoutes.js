const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

// ==========================================
// 💳 NÚCLEO FINANCIERO PAYRAM (Procesamiento Interno)
// ==========================================

/**
 * Generador Maestro de Órdenes (Suscripciones, PPV, Tips, Bundles)
 * Esta es la ruta central que dispara el motor de PayRam.
 * Procesa el pago de forma instantánea sin depender de webhooks externos.
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