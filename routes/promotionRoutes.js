// backend/routes/promotionRoutes.js
const express = require('express');
const router = express.Router();
const promotionController = require('../controllers/promotionController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

router.post('/buy', verifyToken, isCreator, promotionController.buyBoost);
router.get('/status', verifyToken, isCreator, promotionController.getStatus); // 🔥 La nueva ruta

module.exports = router;