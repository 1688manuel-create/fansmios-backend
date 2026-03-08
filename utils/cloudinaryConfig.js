// backend/utils/cloudinaryConfig.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

// 1. Conectamos con tus credenciales de la nube
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// 2. Configuramos la bóveda donde se guardarán los archivos
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'fansmios_uploads', // Una carpeta dentro de tu nube para tener todo ordenado
    allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'webp'], // Soportamos fotos y videos
    resource_type: 'auto' // Detecta automáticamente si es imagen o video
  }
});

// 3. Creamos el "cargador" que usaremos en nuestras rutas
const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };