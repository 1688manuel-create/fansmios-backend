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

// --- RUTAS DE RETOS PRIVADOS (FASE 1) ---
// 🔥 DOBLE BLINDAJE: Solo usuarios logueados que sean CREADORES pueden modificar esto
router.post('/challenges', verifyToken, isCreator, liveController.createChallenge);
router.put('/challenges/:challengeId', verifyToken, isCreator, liveController.toggleChallenge);
router.delete('/challenges/:challengeId', verifyToken, isCreator, liveController.deleteChallenge);

// Ruta pública para que los fans vean los retos en la sala
router.get('/challenges/:creatorId', verifyToken, liveController.getCreatorChallenges);

// ==========================================
// 💬 RUTAS GENERALES Y DE MONETIZACIÓN
// ==========================================
// Comprar Ticket VIP al instante
router.post('/buy-ticket', verifyToken, liveController.buyLiveTicket);

// Enviar mensajes normales o Propinas (Super Chat)
router.post('/message', verifyToken, liveController.sendLiveMessage);

// Entrar a una sala (Aquí el controlador valida si tiene Ticket PPV o es VIP)
// ⚠️ ESTA RUTA DEBE IR SIEMPRE AL FINAL PARA QUE NO CHOQUE CON LAS DEMÁS
router.get('/:streamId', verifyToken, liveController.getLiveStream); 

module.exports = router;