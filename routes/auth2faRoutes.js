// backend/routes/auth2faRoutes.js
const express = require('express');
const router = express.Router();
const auth2faController = require('../controllers/auth2faController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🛡️ Rutas de Seguridad 2FA
router.post('/generate', verifyToken, auth2faController.generate2FA);
router.post('/verify', verifyToken, auth2faController.verifyAndEnable2FA);

module.exports = router;