// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rutas base
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout-global', authController.logoutGlobal);

// 🔥 NUEVAS RUTAS DE LA PUERTA DE HIERRO (Verificación de Email)
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

// Rutas de Recuperación de Contraseña
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Rutas de 2FA (Autenticación de 2 Factores)
router.post('/2fa/generate', authController.generate2FA);
router.post('/2fa/verify', authController.verify2FA);

module.exports = router;