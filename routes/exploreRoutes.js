// backend/routes/exploreRoutes.js
const express = require('express');
const router = express.Router();
const exploreController = require('../controllers/exploreController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 Rutas Generales (Cualquier usuario logueado puede buscar)
router.get('/suggested', verifyToken, exploreController.getSuggestedCreators);
router.get('/search', verifyToken, exploreController.searchCreators);

module.exports = router;