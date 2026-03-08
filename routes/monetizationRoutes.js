// backend/routes/monetizationRoutes.js
const express = require('express');
const router = express.Router();
const monetizationController = require('../controllers/monetizationController');

// Importamos a nuestros guardias
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// 🟢 RUTAS DE SUSCRIPCIÓN (Fans)
// Suscribirse a un creador
router.post('/subscribe', verifyToken, monetizationController.subscribeToCreator);

// Cancelar la renovación automática
router.post('/cancel-subscription', verifyToken, monetizationController.cancelSubscription);

// Ver el historial de lo que ha pagado el Fan
router.get('/my-subscriptions', verifyToken, monetizationController.getMySubscriptions);

// ⚙️ RUTA DEL SISTEMA (Renovaciones automáticas y periodos de gracia)
// Por seguridad, solo tú (Admin) o el sistema automatizado puede llamar a esta ruta
router.post('/system/process-renewals', verifyToken, isAdmin, monetizationController.processRenewals);

// 🟢 RUTAS DE PAGO POR POST (PPV)
// Comprar un post bloqueado
router.post('/purchase-post', verifyToken, monetizationController.purchasePost);

// Ver la galería de posts que el Fan ya compró
router.get('/my-purchases', verifyToken, monetizationController.getMyPurchasedPosts);

// Comprar un mensaje bloqueado
router.post('/purchase-message', verifyToken, monetizationController.purchaseMessage);

// 🎁 RUTA DE PROPINAS
// Enviar una propina con monto libre
router.post('/send-tip', verifyToken, monetizationController.sendTip);

module.exports = router;