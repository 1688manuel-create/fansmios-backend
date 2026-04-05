const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

// 🔥 IMPORTANTE: Traemos el guardia flexible y el estricto
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware');

// Rutas privadas (El usuario DEBE estar logueado para editar su propio perfil)
router.get('/me', verifyToken, profileController.getProfile);
router.put('/me', verifyToken, profileController.updateProfile);

// 🔓 RUTA PÚBLICA: Usamos 'optionalAuth' para que CUALQUIERA (visitantes) pueda ver esto
router.get('/:username', optionalAuth, profileController.getPublicProfile);

// 💥 RUTA DE AUTODESTRUCCIÓN (Protegida con verifyToken)
router.delete('/delete-account', verifyToken, profileController.deleteMyAccount);

module.exports = router;