// backend/routes/seriesRoutes.js
const express = require('express');
const router = express.Router();
const seriesController = require('../controllers/seriesController');

// 🔥 AQUÍ ESTABA EL ERROR: Agregamos la "s" a middlewares
const { verifyToken } = require('../middlewares/authMiddleware'); 
const upload = require('../utils/multerConfig');

// Rutas Públicas (Cualquiera puede ver la vitrina)
router.get('/creator/:username', verifyToken, seriesController.getCreatorSeries);

// Rutas Privadas del Creador (Para crear y subir videos)
router.post('/', verifyToken, upload.single('thumbnail'), seriesController.createSeries);
router.post('/:seriesId/episodes', verifyToken, upload.single('video'), seriesController.addEpisode);

// Ruta de Compra (Covra Pay)
router.post('/:seriesId/buy', verifyToken, seriesController.buySeries);

module.exports = router;