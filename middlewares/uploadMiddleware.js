// backend/middlewares/uploadMiddleware.js
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // 👈 Importamos la herramienta de sistema de archivos

// 🔥 BLINDAJE: Si la carpeta 'uploads' no existe, el servidor la crea mágicamente
const dir = './uploads';
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// Configuramos dónde y cómo se guardan los archivos (fotos, audios, videos)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Nombre único basado en la fecha y hora
    cb(null, Date.now() + path.extname(file.originalname)); 
  }
});

// 🔥 NUEVO FILTRO: Ahora acepta Imágenes, Videos y Audios
const fileFilter = (req, file, cb) => {
  if (
    file.mimetype.startsWith('image/') || 
    file.mimetype.startsWith('video/') || 
    file.mimetype.startsWith('audio/')
  ) {
    cb(null, true); // ¡Déjalo pasar! ✅
  } else {
    cb(new Error('Formato no válido. Solo se permiten imágenes, videos o audios.'), false); // ¡Rechazado! ❌
  }
};

const upload = multer({ storage: storage, fileFilter: fileFilter });

module.exports = upload;