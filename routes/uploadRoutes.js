// backend/routes/uploadRoutes.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const cloudinary = require('../config/cloudinary'); // 🔥 IMPORTAMOS LA BÓVEDA
const upload = require('../middlewares/uploadMiddleware'); 
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 RUTA: Subir un archivo y enviarlo directo a Cloudinary
router.post('/', verifyToken, upload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo.' });
    }

    // ☁️ 1. Disparamos el archivo a la Bóveda de Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'auto', // Magia: Acepta fotos, videos y audios automáticamente
      folder: 'fansmios_general' // Carpeta dentro de tu Cloudinary
    });

    // 🗑️ 2. Borramos el archivo de la Aduana (tu servidor local)
    fs.unlinkSync(req.file.path);
    
    // 3. Devolvemos el Link Inmortal al Frontend
    res.status(200).json({ 
      message: 'Archivo asegurado en la nube exitosamente ☁️🖼️', 
      url: result.secure_url 
    });

  } catch (error) {
    console.error('Error al subir a Cloudinary:', error);
    // Si algo falla, intentamos borrar el archivo local para no dejar basura
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Error interno al guardar en la nube.' });
  }
});

module.exports = router;