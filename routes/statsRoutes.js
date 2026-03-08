// backend/routes/statsRoutes.js
const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// Obtener las estadísticas del creador
router.get('/', verifyToken, isCreator, statsController.getCreatorStats);

module.exports = router;