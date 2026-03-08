// backend/routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

// 🟢 RUTA CORREGIDA: Esta es la que busca el Feed (GET /api/wallet)
router.get('/', verifyToken, walletController.getWallet);

// 🔵 Rutas del Dashboard financiero
router.get('/balance', verifyToken, isCreator, walletController.getWalletBalance);
router.get('/history', verifyToken, isCreator, walletController.getTransactionHistory);
router.post('/withdraw', verifyToken, isCreator, walletController.requestWithdrawal);
router.get('/withdrawals', verifyToken, isCreator, walletController.getWithdrawalHistory);
router.get('/dashboard', verifyToken, isCreator, walletController.getWalletDashboard);
router.put('/update-crypto', verifyToken, walletController.updateCryptoAddress);

module.exports = router;