// backend/routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminPayoutController = require('../controllers/adminPayoutController'); // 🔥 NUEVO CEREBRO DE PAGOS
const adminKycController = require('../controllers/adminKycController'); // 🔥 NUEVO CEREBRO LEGAL
const adminAnalyticsController = require('../controllers/adminAnalyticsController');
const settingsController = require('../controllers/settingsController'); // 🔥 CEREBRO DE COMISIONES

// 🛡️ Importamos a los guardias de seguridad (Solo el CEO pasa)
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// ==========================================
// 🏦 RUTAS DE PAGOS Y RETIROS CRIPTO (FASE 6)
// ==========================================
// 1. Ver lista de retiros pendientes para el Panel Antifraude
router.get('/payouts/pending', verifyToken, isAdmin, adminPayoutController.getPendingWithdrawals);

// 2. Botón Verde: Aprobar y procesar pago
router.post('/payouts/:withdrawalId/approve', verifyToken, isAdmin, adminPayoutController.approveWithdrawal);

// 3. Botón Rojo: Rechazar pago y devolver fondos al creador
router.post('/payouts/:withdrawalId/reject', verifyToken, isAdmin, adminPayoutController.rejectWithdrawal);

// ==========================================
// 🛡️ RUTAS DE VERIFICACIÓN LEGAL (KYC)
// ==========================================
router.get('/kyc/pending', verifyToken, isAdmin, adminKycController.getPendingKyc);
router.post('/kyc/:profileId/approve', verifyToken, isAdmin, adminKycController.approveKyc);
router.post('/kyc/:profileId/reject', verifyToken, isAdmin, adminKycController.rejectKyc);

// ==========================================
// ⚙️ RUTAS DE ADMINISTRACIÓN GENERAL Y MODERACIÓN
// ==========================================
// Acciones ejecutivas
router.put('/user-status', verifyToken, isAdmin, adminController.changeUserStatus);
router.put('/reports/resolve', verifyToken, isAdmin, adminController.resolveReport);

// 👑 RUTAS DEL MODO DIOS (Protegidas por los guardias del CEO)
router.get('/platform-settings', verifyToken, isAdmin, settingsController.getPlatformSettings);
router.put('/platform-settings', verifyToken, isAdmin, settingsController.updatePlatformSettings);

// Obtención de datos y Listas
router.get('/reports', verifyToken, isAdmin, adminController.getReports);
router.get('/stats', verifyToken, isAdmin, adminController.getGlobalStats);
router.get('/users', verifyToken, isAdmin, adminController.getAllUsers);

// ==========================================
// 📊 RUTAS DEL SUPERADMIN (FASE 7)
// ==========================================
router.get('/analytics/dashboard', verifyToken, isAdmin, adminAnalyticsController.getSuperAdminDashboard);

module.exports = router;