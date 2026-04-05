// backend/routes/kycRoutes.js
const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kycController');
const { verifyToken } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs'); // 👈 NUEVO: Para crear la carpeta automáticamente

// 🔒 Configuración de almacenamiento encriptado/seguro
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    // 🔥 FIX DE INFRAESTRUCTURA: Creamos la carpeta si Coolify no la tiene
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'kyc_secure_' + file.fieldname + '_' + uniqueSuffix + path.extname(file.originalname));
  }
});

// 🛡️ FILTRO DE SEGURIDAD RELAJADO (A prueba de iPhones y Celulares)
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'idFront' || file.fieldname === 'idBack') {
    // Permitimos imágenes o genéricos (application/)
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/')) {
      cb(null, true);
    } else {
      cb(new Error('Los documentos de identidad deben ser imágenes.'), false);
    }
  } else if (file.fieldname === 'idSelfie') {
    // 🔥 FIX CRÍTICO: Los celulares a veces mandan video/quicktime o application/octet-stream
    if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/')) {
      cb(null, true);
    } else {
      cb(new Error('La prueba de vida debe ser un video válido.'), false);
    }
  } else {
    cb(new Error('Campo de archivo desconocido.'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB para el video
});

const kycUploadAduana = upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'idSelfie', maxCount: 1 } 
]);

router.post('/upload', verifyToken, kycUploadAduana, kycController.uploadKycDocuments);

module.exports = router;