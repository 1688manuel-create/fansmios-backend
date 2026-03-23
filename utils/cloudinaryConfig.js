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

// 2. Configuramos la bóveda con INTELIGENCIA ARTIFICIAL DE RECORTE
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Valores por defecto para posts normales
    let folderName = 'fansmio_uploads';
    let transformations = [];

    // 🔥 MAGIA: Si detecta que están subiendo un Avatar
    if (file.fieldname === 'profileImage') {
      folderName = 'fansmio_avatares';
      // Cuadrado perfecto (400x400), detecta la cara y recorta alrededor de ella
      transformations = [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }];
    } 
    // 🔥 MAGIA: Si detecta que están subiendo una Portada
    else if (file.fieldname === 'coverImage') {
      folderName = 'fansmio_portadas';
      // Rectángulo panorámico (1920x1080), centrado
      transformations = [{ width: 1920, height: 1080, crop: 'fill', gravity: 'center', quality: 'auto' }];
    }

    return {
      folder: folderName,
      allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'webp', 'mov', 'webm', 'mp3', 'wav', 'ogg'],
      resource_type: 'auto',
      // Solo aplicamos transformación si es foto de perfil o portada
      transformation: transformations.length > 0 ? transformations : undefined
    };
  }
});

// 3. Creamos el "cargador" maestro
const uploadCloudinary = multer({ storage: storage });

module.exports = { cloudinary, uploadCloudinary };