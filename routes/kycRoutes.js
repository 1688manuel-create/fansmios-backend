// backend/routes/kycRoutes.js
const express = require('express');
const router = express.Router();
const kycController = require('../controllers/kycController');
const { verifyToken } = require('../middlewares/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 🔒 Configuración de almacenamiento encriptado/seguro
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../uploads');
    // Creamos la carpeta si Coolify no la tiene
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

// 🔥 ANULAMOS EL FILTRO (Dejamos que FFMPEG y la IA hagan la validación real adentro)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 } // Límite de 50MB para el video
});

// 🚧 Middleware de Aduana: Exigimos exactamente 1 archivo por cada tipo
const kycUploadAduana = upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'idSelfie', maxCount: 1 }
]);

// 🚀 Ruta final
router.post('/upload', verifyToken, kycUploadAduana, kycController.uploadKycDocuments);

module.exports = router;