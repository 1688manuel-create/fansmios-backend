// backend/routes/kycRoutes.js
const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kycController');
const { verifyToken } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');

// 🔒 Configuración de almacenamiento encriptado/seguro
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Se guardarán en la carpeta uploads de tu backend
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // Renombramos el archivo para que nadie sepa de quién es a simple vista
    cb(null, 'kyc_secure_' + file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname));
  }
});

// 🛡️ FILTRO DE SEGURIDAD (Aceptando Videos)
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'idFront' || file.fieldname === 'idBack') {
    // El Frente y Reverso deben ser imágenes (JPG, PNG, etc)
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Los documentos de identidad deben ser imágenes.'), false);
    }
  } else if (file.fieldname === 'idSelfie') {
    // 🔥 LA PRUEBA DE VIDA AHORA ACEPTA VIDEOS (.webm, .mp4) O IMÁGENES
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('La prueba de vida debe ser un video válido.'), false);
    }
  } else {
    cb(new Error('Campo de archivo desconocido.'), false);
  }
};

// Instanciamos multer con el almacenamiento y el filtro
const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB para el video
});

// 🚧 Middleware de Aduana: Exigimos exactamente 1 archivo por cada tipo
const kycUploadAduana = upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'idSelfie', maxCount: 1 } // Aquí viaja el video
]);

// 🚀 Ruta final: /api/profile/kyc/upload
router.post('/upload', verifyToken, kycUploadAduana, kycController.uploadKycDocuments);

module.exports = router;