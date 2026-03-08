// backend/routes/liveRoutes.js
const express = require('express');
const router = express.Router();
const liveController = require('../controllers/liveController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// ==========================================
// 📡 RUTAS DEL MURO / FEED
// ==========================================
router.get('/active', verifyToken, liveController.getFeedStreams);

// ==========================================
// 🎥 RUTAS EXCLUSIVAS DEL CREADOR
// ==========================================
// 🔥 CORRECCIÓN: Cambiamos '/start' por '/create' para que conecte con el Frontend
router.post('/create', verifyToken, isCreator, liveController.createLiveStream);
router.put('/:streamId/status', verifyToken, isCreator, liveController.updateStreamStatus);

// ==========================================
// 💬 RUTAS GENERALES Y DE MONETIZACIÓN
// ==========================================
// Enviar mensajes normales o Propinas (Super Chat)
router.post('/message', verifyToken, liveController.sendLiveMessage);

// Entrar a una sala (Aquí el controlador valida si tiene Ticket PPV o es VIP)
router.get('/:streamId', verifyToken, liveController.getLiveStream); // 👈 Siempre al final

module.exports = router;