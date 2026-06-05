const express = require('express');
const router = express.Router();
const { serveFile } = require('../controllers/fileController');

// Token-authenticated receipt serving for the local storage driver. The signed
// token in the path carries the object key + expiry, so no auth middleware.
router.get('/:token', serveFile);

module.exports = router;
