// backend/routes/discoverRoutes.js
const express = require('express');
const router = express.Router();
const discoverController = require('../controllers/discoverController');
const { verifyToken } = require('../middlewares/authMiddleware');

// Ruta para obtener la lista de creadores (con búsqueda y filtros)
router.get('/creators', verifyToken, discoverController.getCreators);

module.exports = router;