// backend/routes/fanRoutes.js
const express = require('express');
const router = express.Router(); // ⚠️ Corrección: es express.Router()
const fanController = require('../controllers/fanController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Obtener las suscripciones activas del fan
router.get('/subscriptions', verifyToken, fanController.getMySubscriptions);

module.exports = router;