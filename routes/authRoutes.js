// backend/routes/authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// 🔥 1. IMPORTAMOS AL CADENERO (RATE LIMITER)
const rateLimit = require('express-rate-limit');

// 🔥 2. CONFIGURAMOS EL LÍMITE SOLO PARA EL LOGIN (5 intentos)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos de castigo
  max: 5, // A los 5 intentos fallidos, se bloquea
  message: { error: 'Demasiados intentos de inicio de sesión. Por favor, espera 15 minutos. 🛡️' }
});

// Rutas base
router.post('/register', authController.register);

// 🔥 3. PONEMOS AL CADENERO EXACTAMENTE EN LA PUERTA DEL LOGIN
router.post('/login', loginLimiter, authController.login);

router.post('/logout-global', authController.logoutGlobal);

// Rutas de la Puerta de Hierro (Verificación de Email)
router.post('/verify-email', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

// Rutas de Recuperación de Contraseña
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Rutas de 2FA (Autenticación de 2 Factores)
router.post('/2fa/generate', authController.generate2FA);
router.post('/2fa/verify', authController.verify2FA);
router.post('/verify-2fa', authController.verify2FALogin);

module.exports = router;