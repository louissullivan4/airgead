const jwt = require('jsonwebtoken');
const path = require('path');
const storage = require('../utils/storage');
const logger = require('../utils/logger');

// Minimal extension -> content-type map for the receipt types we accept.
const CONTENT_TYPES = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
};

// Serve a receipt referenced by a short-lived signed token — the local storage
// driver's counterpart to a GCS signed URL. The token (minted in
// storage.getSignedUrl) carries the object key and an expiry; we verify it and
// stream the bytes. The token IS the authorisation, so no JWT auth middleware
// guards this route.
const serveFile = async (req, res) => {
    try {
        let payload;
        try {
            payload = jwt.verify(req.params.token, process.env.JWT_SECRET);
        } catch (err) {
            return res.status(403).json({ error: 'Invalid or expired link.' });
        }

        const objectPath = payload.obj;
        if (!objectPath || !(await storage.exists(objectPath))) {
            return res.status(404).json({ error: 'File not found.' });
        }

        const ext = path.extname(objectPath).toLowerCase();
        res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');

        storage.createReadStream(objectPath)
            .on('error', (err) => {
                logger.error('Error streaming receipt %s: %s', objectPath, err.message);
                if (!res.headersSent) res.status(500).end();
            })
            .pipe(res);
    } catch (error) {
        logger.error('Error serving file: %s', error.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
};

module.exports = { serveFile };
