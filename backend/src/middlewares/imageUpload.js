require('dotenv').config();

const { v4: uuidv4 } = require('uuid');
const { getBucket } = require('../utils/gcs');
const logger = require('../utils/logger');

const uploadBase64Image = async (req, res, next) => {
    try {
        if (!req.body.image) {
            return next();
        }

        const dataUri = req.body.image;

        const matches = dataUri.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) {
            return res.status(400).json({ error: 'Invalid image format. Please provide a valid Base64-encoded image.' });
        }

        const imageType = matches[1].split('/')[1];
        const imageBase64 = matches[2];

        const imageBuffer = Buffer.from(imageBase64, 'base64');

        // Receipt identifier: provided filename (validated) or a generated uuid.
        let receiptId;
        if (req.body.filename) {
            const validFilename = req.body.filename.trim();
            const filenameRegex = /^[a-zA-Z0-9_-]+$/;
            if (!filenameRegex.test(validFilename)) {
                return res.status(400).json({ error: 'Invalid filename. Only alphanumeric characters, underscores, and hyphens are allowed.' });
            }
            receiptId = validFilename;
        } else {
            receiptId = uuidv4();
        }

        // Tenant-scoped object key: org_<orgId>/<year>/<receiptId>.<ext>.
        // Falls back to the legacy flat "ids/" prefix when orgId is absent (e.g.
        // pre-Task-4 tokens). Not fully tenant-isolated until orgId is present.
        const orgId = req.user && req.user.orgId;
        let objectPath;
        if (orgId) {
            const year = new Date().getFullYear();
            objectPath = `org_${orgId}/${year}/${receiptId}.${imageType}`;
        } else {
            logger.warn('Uploading receipt without orgId — using legacy "ids/" prefix.');
            objectPath = `ids/${receiptId}.${imageType}`;
        }

        const file = getBucket().file(objectPath);

        const stream = file.createWriteStream({
            metadata: {
                contentType: matches[1],
            },
            resumable: false,
        });

        stream.on('error', (err) => {
            logger.error('Error uploading image to GCS: %s', err.message);
            return res.status(500).json({ error: 'Failed to upload image. Please try again later.' });
        });

        stream.on('finish', () => {
            // Objects are PRIVATE now (no makePublic). Store the object path —
            // not a public URL. Reads go through signed URLs (see signedUrl.js).
            req.body.image = objectPath;
            next();
        });

        stream.end(imageBuffer);
    } catch (error) {
        logger.error('Error processing image upload: %s', error.message);
        res.status(500).json({ error: 'Failed to process image upload. Please try again later.' });
    }
};

module.exports = {
    uploadBase64Image,
};
