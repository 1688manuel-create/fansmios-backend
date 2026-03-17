// backend/routes/postRoutes.js
const express = require('express');
const router = express.Router();
const postController = require('../controllers/postController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🔥 IMPORTAMOS EL CARGADOR DE LA NUBE
const { uploadCloudinary } = require('../utils/cloudinaryConfig');

// ☁️ Usamos uploadCloudinary para interceptar la foto y mandarla a la Bóveda
router.post('/', verifyToken, uploadCloudinary.single('media'), postController.createPost);

router.get('/', verifyToken, postController.getAllPosts);
router.get('/creator/:username', verifyToken, postController.getCreatorPosts);
router.post('/:id/like', verifyToken, postController.toggleLike);
router.post('/:id/comment', verifyToken, postController.addComment);
router.post('/comment/:id/like', verifyToken, postController.toggleCommentLike);
router.post('/:id/boost', verifyToken, postController.buyBoost);
router.delete('/:id', verifyToken, postController.deletePost);

module.exports = router;