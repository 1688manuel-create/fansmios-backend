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
    let folderName = 'fansmio_uploads';
    let transformations = [];
    let resourceType = 'auto';

    // 🔥 MAGIA: Si detecta que están subiendo un Avatar
    if (file.fieldname === 'profileImage') {
      folderName = 'fansmio_avatares';
      transformations = [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }];
    } 
    // 🔥 MAGIA: Si detecta que están subiendo una Portada
    else if (file.fieldname === 'coverImage') {
      folderName = 'fansmio_portadas';
      transformations = [{ width: 1920, height: 1080, crop: 'fill', gravity: 'center', quality: 'auto' }];
    }
    // 🛑 NUEVA REGLA TÁCTICA: Blindaje para Videos
    else if (file.mimetype.startsWith('video/')) {
      folderName = 'fansmio_videos';
      resourceType = 'video';
      transformations = [
        { 
          width: 1920, 
          height: 1080, 
          crop: 'limit', // 'limit' baja los 4K a 1080p, pero NO estira los videos de 720p (evita que se pixelen)
          quality: 'auto', 
          duration: "300" // Guillotina: Corta automáticamente a 5 minutos (300 segundos)
        }
      ];
    }

    return {
      folder: folderName,
      allowed_formats: ['jpg', 'png', 'jpeg', 'mp4', 'webp', 'mov', 'webm', 'mp3', 'wav', 'ogg'],
      resource_type: resourceType,
      transformation: transformations.length > 0 ? transformations : undefined
    };
  }
});

// 3. Creamos el "cargador" maestro con LÍMITE DE PESO
const uploadCloudinary = multer({ 
  storage: storage,
  limits: {
    fileSize: 150 * 1024 * 1024 // 🔥 Límite de 150 MB por archivo. Evita ataques de denegación de servicio (DDoS) o saturación.
  }
});

module.exports = { cloudinary, uploadCloudinary };