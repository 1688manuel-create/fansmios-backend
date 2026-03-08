// backend/routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');

const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 Rutas para manejar la campanita
router.get('/', verifyToken, notificationController.getMyNotifications);
router.put('/read-all', verifyToken, notificationController.markAllAsRead);
router.put('/:notificationId/read', verifyToken, notificationController.markAsRead);
router.post('/fcm-token', verifyToken, notificationController.saveFcmToken);

module.exports = router;