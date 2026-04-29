// backend/routes/moderationRoutes.js
const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');

const { verifyToken } = require('../middlewares/authMiddleware');

// 🛡️ Ruta para que cualquier usuario envíe un reporte
router.post('/report', verifyToken, moderationController.submitReport);

// 🔥 NUEVO: Ruta del Protocolo de Silencio (Bisturí de Audio DMCA)
router.post('/mute-video', verifyToken, moderationController.muteCopyrightedVideo);

module.exports = router;