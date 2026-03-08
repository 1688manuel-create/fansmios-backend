// backend/routes/referralRoutes.js
const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { verifyToken } = require('../middlewares/authMiddleware');

// 🟢 Rutas protegidas (El usuario debe estar logueado para ver su link y sus ganancias)
router.get('/my-link', verifyToken, referralController.getMyReferralInfo);
router.get('/my-network', verifyToken, referralController.getMyNetwork);

module.exports = router;