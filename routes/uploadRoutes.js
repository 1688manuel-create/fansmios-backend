// backend/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const { uploadCloudinary } = require('../utils/cloudinaryConfig');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, uploadCloudinary.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envio ningun archivo.' });
    }

    // Al usar uploadCloudinary, req.file.path ya contiene el enlace publico seguro
    res.status(200).json({ 
      message: 'Archivo subido exitosamente a la nube', 
      url: req.file.path 
    });

  } catch (error) {
    console.error('Error en la ruta de subida:', error);
    res.status(500).json({ error: 'Error interno al guardar el archivo.' });
  }
});

module.exports = router;