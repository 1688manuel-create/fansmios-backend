// backend/routes/postRoutes.js
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit'); // 🔥 Importamos la armadura Anti-Spam
const postController = require('../controllers/postController');

// 🔥 CORRECCIÓN: Traemos ambos guardias de seguridad (Estricto y Flexible)
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware'); 

// ==========================================
// 🛡️ CONFIGURACIÓN DEL ESCUDO ANTI-SPAM
// ==========================================

// 1. Límite para Publicaciones: Máximo 5 posts cada 5 minutos
const postLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos de "memoria"
  max: 5, // Bloquea después de 5 intentos
  message: { error: '🚨 Estás publicando demasiado rápido. Por favor, espera unos minutos.' },
  standardHeaders: true, // Envía la info del límite en los headers
  legacyHeaders: false,
});

// 2. Límite para Comentarios: Máximo 10 comentarios por minuto
const commentLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto de "memoria"
  max: 10, // Bloquea después de 10 intentos
  message: { error: '🚨 Cálmate un poco, estás comentando muy rápido. ¡Pausa anti-spam!' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==========================================
// RUTAS DE PUBLICACIONES (POSTS)
// ==========================================

// 🔥 Inyectamos el postLimiter justo después de verificar el Token
router.post('/', verifyToken, postLimiter, upload.single('image'), postController.createPost);

router.get('/', verifyToken, postController.getAllPosts);

// 🔓 AQUÍ ESTÁ LA MAGIA: Usamos optionalAuth para que los visitantes (sin cuenta) puedan ver el perfil público
router.get('/creator/:username', optionalAuth, postController.getCreatorPosts);

// Ruta para eliminar el post
router.delete('/:id', verifyToken, postController.deletePost);

// ==========================================
// RUTAS DE INTERACCIONES (LIKES Y COMENTARIOS)
// ==========================================

router.post('/:id/like', verifyToken, postController.toggleLike);

// 🔥 Inyectamos el commentLimiter para proteger los comentarios
router.post('/:id/comment', verifyToken, commentLimiter, postController.addComment);

router.post('/comment/:id/like', verifyToken, postController.toggleCommentLike);

// 🚀 RUTAS DE MONETIZACIÓN Y BOOST
router.post('/buy-boost', verifyToken, postController.buyBoost);

module.exports = router;