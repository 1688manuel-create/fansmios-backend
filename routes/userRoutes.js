// backend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

// 🔥 Importamos Multer para manejar la subida de múltiples imágenes
const upload = require('../utils/multerConfig'); 

// Importamos a nuestros guardias de seguridad
const { verifyToken, isCreator, isAdmin } = require('../middlewares/authMiddleware');

// 🟢 RUTA DE FAN (Solo requiere estar logueado para pasar)
router.post('/become-creator', verifyToken, userController.becomeCreator);

// 🔵 RUTA PARA OBTENER EL PERFIL (Necesaria para que el formulario cargue tus datos actuales)
router.get('/profile', verifyToken, userController.getProfile);

// 👑 RUTA DE EDITAR PERFIL (Fotos + Datos)
// Quitamos 'isCreator' para darle LIBERTAD TOTAL AL ADMIN. El controlador ya se encarga de la seguridad.
// Usamos upload.fields para atrapar las dos fotos en una sola petición.
router.put(
  '/profile', 
  verifyToken, 
  upload.fields([
    { name: 'profileImage', maxCount: 1 },
    { name: 'coverImage', maxCount: 1 }
  ]), 
  userController.updateProfile
);

// 🔴 RUTA DE ADMIN (Requiere estar logueado Y ser exclusivamente Admin)
router.get('/all', verifyToken, isAdmin, userController.getAllUsers);

// 🚀 RUTA PARA LA BARRA LATERAL VIP (Accesible para todos, incluso visitantes)
router.get('/trending', userController.getTrendingCreators);

// 🟢 RUTA PARA SEGUIR/DEJAR DE SEGUIR (Cualquier usuario logueado puede hacerlo)
router.post('/:id/follow', verifyToken, userController.toggleFollow);

// 🔥 RUTAS DE CONFIGURACIÓN (SETTINGS)
router.put('/settings/email', verifyToken, userController.updateEmail);
router.put('/settings/password', verifyToken, userController.updatePassword);

// 🔔 Actualizar Notificaciones (¡GUARDIA CORREGIDO A verifyToken! 👮‍♂️)
router.put('/settings/notifications', verifyToken, userController.updateNotificationSettings);

// 🔔 Rutas de Notificaciones In-App
router.get('/notifications', verifyToken, userController.getMyNotifications);
router.put('/notifications/read', verifyToken, userController.markNotificationsAsRead);

// Guardar Token de Firebase (Push)
router.post('/settings/push-token', verifyToken, userController.savePushToken);

router.get('/vip-story', userController.getVipCreator);

module.exports = router;