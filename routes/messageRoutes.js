// backend/routes/messageRoutes.js
const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware'); // Middleware para las fotos y audios

// Todas las rutas están protegidas
router.use(verifyToken);

// 0. Obtener lista de chats
router.get('/conversations', messageController.getConversations);

// 0.5 Obtener conteo de no leídos
router.get('/unread', messageController.getUnreadCount);

// 1. Obtener el historial de un chat en específico
router.get('/:conversationId', messageController.getConversation);

// 2. Enviar mensaje (acepta archivos en el campo 'media')
router.post('/send', upload.single('media'), messageController.sendMessage);

// 3. Bloquear / Desbloquear y Verificar
router.post('/block', messageController.blockUser);
router.post('/unblock', messageController.unblockUser);
router.get('/block-status/:userId', messageController.checkBlockStatus);

// 4. Enviar Broadcast (Solo creadores)
router.post('/broadcast', isCreator, upload.single('media'), messageController.sendBroadcast);

// 5. Eliminar mensaje
router.delete('/:messageId', messageController.deleteMessage);

module.exports = router;