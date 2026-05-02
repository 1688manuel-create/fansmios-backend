// backend/routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { verifyToken } = require('../middlewares/authMiddleware');

// ==========================================
// 💳 NÚCLEO FINANCIERO FANSMIOS (Motor Híbrido Covra + PayRam)
// ==========================================

/**
 * 🚀 Generador Maestro de Órdenes (Suscripciones, PPV, Tips, Bundles y Recargas)
 * * Esta es la ruta central del imperio:
 * - Si es una RECARGA ('CREDIT_TOPUP'): Genera un link externo hacia Covra Pay / PayRam.
 * - Si es un PAGO INTERNO (Sub, PPV): Procesa el movimiento atómico de saldo entre bóvedas en DÓLARES.
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