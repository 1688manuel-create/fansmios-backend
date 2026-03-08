const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Ruta para el dashboard del Creador
router.get('/creator', verifyToken, analyticsController.getCreatorDashboard);

module.exports = router;