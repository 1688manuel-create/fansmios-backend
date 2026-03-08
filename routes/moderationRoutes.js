// backend/routes/moderationRoutes.js
const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');

const { verifyToken } = require('../middlewares/authMiddleware');

// 🛡️ Ruta para que cualquier usuario envíe un reporte
router.post('/report', verifyToken, moderationController.submitReport);

module.exports = router;