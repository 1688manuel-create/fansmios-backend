// backend/routes/dashboardRoutes.js
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

// Guardias de seguridad
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// 🔵 Ruta exclusiva para el panel de control del creador
router.get('/main-stats', verifyToken, isCreator, dashboardController.getMainStats);

// 🔵 Ruta exclusiva para las métricas avanzadas (Top fans, Churn, Crecimiento)
router.get('/advanced-stats', verifyToken, isCreator, dashboardController.getAdvancedStats);

module.exports = router;