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
    folder: 'fansmios_uploads', // Carpeta principal en tu nube
    allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'webp', 'mov', 'webm', 'mp3', 'wav', 'ogg'], // 🚀 Ampliado para multimedia total
    resource_type: 'auto' // Detecta automáticamente si es imagen, video o audio
  }
});

// 3. Creamos el "cargador" maestro
const uploadCloudinary = multer({ storage: storage });

module.exports = { cloudinary, uploadCloudinary };