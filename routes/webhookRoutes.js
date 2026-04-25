const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// 🚀 Ruta: POST /api/webhooks/payram
router.post('/payram', webhookController.handlePayRamWebhook);

module.exports = router;