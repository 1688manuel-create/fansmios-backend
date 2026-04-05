const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');

// 🔥 IMPORTANTE: Traemos el guardia flexible para la ruta pública
const { verifyToken, optionalAuth } = require('../middlewares/authMiddleware');

const { deleteMyAccount } = require('../controllers/profileController');

// Rutas privadas (El usuario DEBE estar logueado para editar su propio perfil)
router.get('/me', verifyToken, profileController.getProfile);
router.put('/me', verifyToken, profileController.updateProfile);

// 🔓 RUTA PÚBLICA: Usamos 'optionalAuth' para que CUALQUIERA (visitantes) pueda ver esto
router.get('/:username', optionalAuth, profileController.getPublicProfile);

router.delete('/delete-account', authMiddleware, deleteMyAccount);

module.exports = router;