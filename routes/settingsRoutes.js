// backend/routes/settingsRoutes.js
const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController'); // 🔥 ESTA ES LA LÍNEA QUE FALTABA

const { verifyToken, isCreator } = require('../middlewares/authMiddleware');

router.put('/user', verifyToken, settingsController.updateUserSettings);
router.put('/creator', verifyToken, isCreator, settingsController.updateCreatorSettings);
router.put('/password', verifyToken, settingsController.updatePassword);
router.get('/billing', verifyToken, settingsController.getBillingHistory);

module.exports = router;