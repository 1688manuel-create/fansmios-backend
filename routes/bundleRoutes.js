// backend/routes/bundleRoutes.js
const express = require('express');
const router = express.Router();
const bundleController = require('../controllers/bundleController');

// Guardias
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// 🟢 RUTAS ESTÁTICAS (Siempre van arriba para que el servidor las lea primero)
router.get('/featured', bundleController.getFeaturedBundle); // 🔥 Aquí está la del Feed

// 🔵 Rutas del Creador
router.post('/create', verifyToken, isCreator, bundleController.createBundle);
router.get('/my-bundles', verifyToken, isCreator, bundleController.getMyBundles);
router.get('/eligible-posts', verifyToken, isCreator, bundleController.getEligiblePosts);

// 🟢 Rutas del Fan
router.post('/purchase', verifyToken, bundleController.purchaseBundle);

// 🟠 RUTAS DINÁMICAS (Llevan los dos puntos ":" y siempre van abajo)
router.get('/creator/:username', verifyToken, bundleController.getCreatorBundles);

// 🔥 NUEVO: Ruta para eliminar un paquete (La que usa el botón rojo del Frontend)
router.delete('/:id', verifyToken, isCreator, bundleController.deleteBundle);

module.exports = router;