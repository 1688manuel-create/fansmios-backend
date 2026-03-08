// backend/utils/multerConfig.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. Aseguramos que la carpeta "uploads" exista
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Configuramos DÓNDE y CÓMO se guardan los archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // Las guardamos en backend/uploads/
  },
  filename: function (req, file, cb) {
    // Le ponemos un nombre único: Fecha + Número Random + Extensión original (.jpg, .png)
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

// 3. Filtro de Seguridad (Solo aceptamos imágenes)
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true); // Es imagen, la dejamos pasar
  } else {
    cb(new Error('¡Solo se permiten archivos de imagen!'), false); // Bloqueado
  }
};

// 4. Creamos el objeto final con un límite de peso (5MB máximo)
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: fileFilter
});

module.exports = upload;