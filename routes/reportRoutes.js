// backend/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');

// Importamos los guardias de seguridad
const { verifyToken, isAdmin } = require('../middlewares/authMiddleware');

// 🟢 RUTAS DE CREACIÓN DE REPORTES (Fans y Creadores)
router.post('/', verifyToken, reportController.createReport);
router.post('/create', verifyToken, reportController.createReport); // Mantenida por retrocompatibilidad

// 🔴 RUTA EXCLUSIVA ADMIN: Ver todos los reportes
router.get('/', verifyToken, isAdmin, reportController.getAllReports);

module.exports = router;