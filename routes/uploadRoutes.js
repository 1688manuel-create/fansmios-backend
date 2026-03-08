// backend/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();

// 🔥 CAMBIO CLAVE: Importamos el multer local que ya funciona perfecto en tus posts
const upload = require('../middlewares/uploadMiddleware'); 
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 RUTA: Subir un archivo al Servidor
router.post('/', verifyToken, upload.single('media'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo.' });
    }

    // Formateamos la ruta exactamente igual que en tu postController.js
    const fileUrl = `/uploads/${req.file.filename}`;
    
    res.status(200).json({ 
      message: 'Archivo subido exitosamente 🖼️', 
      url: fileUrl 
    });
  } catch (error) {
    console.error('Error al subir archivo:', error);
    res.status(500).json({ error: 'Error interno al guardar la imagen.' });
  }
});

module.exports = router;