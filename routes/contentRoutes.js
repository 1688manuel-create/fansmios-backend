// backend/routes/contentRoutes.js
const express = require('express');
const router = express.Router();
const contentController = require('../controllers/contentController');

// Importamos a nuestros guardias de seguridad
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// RUTAS DE POSTS
// Crear requiere ser Creador (o Admin). Eliminar solo requiere estar logueado, la seguridad de dueño se hace adentro.
router.post('/posts', verifyToken, isCreator, contentController.createPost);
router.delete('/posts/:postId', verifyToken, contentController.deletePost);

// Ver el muro de un creador (Aplica reglas de visibilidad automáticamente)
router.get('/posts/:creatorId', verifyToken, contentController.getCreatorPosts);

// RUTAS DE INTERACCIONES (Cualquiera con cuenta puede dar like y comentar)
router.post('/likes', verifyToken, contentController.toggleLike);
router.post('/comments', verifyToken, contentController.addComment);
router.delete('/comments/:commentId', verifyToken, contentController.deleteComment);

module.exports = router;