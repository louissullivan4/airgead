require('dotenv').config();

const { Storage } = require('@google-cloud/storage');
const { v4: uuidv4 } = require('uuid');

const storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);

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

        let filename;
        if (req.body.filename) {
            const validFilename = req.body.filename.trim();
            const filenameRegex = /^[a-zA-Z0-9_-]+$/;
            if (!filenameRegex.test(validFilename)) {
                return res.status(400).json({ error: 'Invalid filename. Only alphanumeric characters, underscores, and hyphens are allowed.' });
            }
            filename = `${validFilename}.${imageType}`;
        } else {
            filename = `${uuidv4()}.${imageType}`;
        }

        const file = bucket.file(`ids/${filename}`);

        const stream = file.createWriteStream({
            metadata: {
                contentType: matches[1],
            },
            resumable: false,
        });

        stream.on('error', (err) => {
            console.error('Error uploading image to GCS:', err);
            return res.status(500).json({ error: 'Failed to upload image. Please try again later.' });
        });

        stream.on('finish', async () => {
            try {
                await file.makePublic();
            } catch (err) {
                console.error('Error making file public:', err);
            }

            const publicUrl = `https://storage.googleapis.com/${bucket.name}/ids/${filename}`;

            req.body.image = publicUrl;
            next();
        });

        stream.end(imageBuffer);
    } catch (error) {
        console.error('Error processing image upload:', error);
        res.status(500).json({ error: 'Failed to process image upload. Please try again later.' });
    }
};

module.exports = {
    uploadBase64Image,
};
