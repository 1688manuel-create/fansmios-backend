// backend/routes/bookmarkRoutes.js
const express = require('express');
const router = express.Router();
const bookmarkController = require('../controllers/bookmarkController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 RUTAS DE FAVORITOS (Requieren estar logueado)

// Ruta para Guardar/Quitar un post específico
router.post('/:postId/toggle', verifyToken, bookmarkController.toggleBookmark);

// Ruta para ver la lista completa de guardados
router.get('/', verifyToken, bookmarkController.getMyBookmarks);

module.exports = router;