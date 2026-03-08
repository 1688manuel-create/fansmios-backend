const express = require('express');
const router = express.Router();
const storyController = require('../controllers/storyController');
const { verifyToken, isCreator } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.post('/', verifyToken, isCreator, upload.single('media'), storyController.createStory);
router.get('/', verifyToken, storyController.getFeedStories);
router.post('/:id/view', verifyToken, storyController.viewStory);

// Estas son las que daban error si no se guardaba el controlador:
router.get('/:id/views', verifyToken, storyController.getStoryViews);
router.delete('/:id', verifyToken, storyController.deleteStory);

module.exports = router;