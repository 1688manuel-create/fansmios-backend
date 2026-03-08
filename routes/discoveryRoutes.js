// backend/routes/discoveryRoutes.js
const express = require('express');
const router = express.Router();
const discoveryController = require('../controllers/discoveryController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 Rutas Públicas (Cualquiera puede buscar y ver los Trending)
// Usamos verifyToken de forma opcional si quieres que solo usuarios registrados busquen
router.get('/search', verifyToken, discoveryController.searchCreators);
router.get('/trending', verifyToken, discoveryController.getTrendingCreators);

// 🔵 Rutas de Interacción (Follows y Favoritos)
router.post('/follow', verifyToken, discoveryController.toggleFollow);
router.post('/bookmark', verifyToken, discoveryController.toggleBookmark);
router.get('/bookmarks', verifyToken, discoveryController.getMyBookmarks);

module.exports = router;