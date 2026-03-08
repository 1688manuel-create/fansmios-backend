const express = require('express');
const router = express.Router();
const couponController = require('../controllers/couponController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/', verifyToken, couponController.createCoupon);
router.get('/', verifyToken, couponController.getMyCoupons);
router.patch('/:id/toggle', verifyToken, couponController.toggleCoupon);
router.post('/validate', verifyToken, couponController.validateCoupon); // Esta la usará el Fan

module.exports = router;