require('dotenv').config();

const { Storage } = require('@google-cloud/storage');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const logger = require('../utils/logger');

const storage = new Storage({
    projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

const bucket = storage.bucket(process.env.GOOGLE_CLOUD_STORAGE_BUCKET);

const downloadImages = async (expenses, imagesDir) => {
    await fs.ensureDir(imagesDir);

    const downloadPromises = expenses
        .filter(expense => expense.receipt_image_url)
        .map(async (expense) => {
            const imageUrl = expense.receipt_image_url;

            const urlParts = imageUrl.split('/');
            const filenameWithQuery = urlParts[urlParts.length - 1];
            const filename = filenameWithQuery.split('?')[0];

            const imageExtension = path.extname(filename) || '.jpg';
            const imageName = `expense_${expense.id}${imageExtension}`;
            const imagePath = path.join(imagesDir, imageName);

            const file = bucket.file(`ids/${filename}`);

            try {
                const [exists] = await file.exists();
                if (!exists) {
                    logger.warn(`File ${filename} does not exist in bucket.`);
                    expense.local_image_path = null;
                    return;
                }

                const readStream = file.createReadStream();

                await fs.ensureDir(path.dirname(imagePath));

                const writeStream = fs.createWriteStream(imagePath);

                await new Promise((resolve, reject) => {
                    readStream.pipe(writeStream)
                        .on('finish', resolve)
                        .on('error', reject);
                });

                expense.local_image_path = imagePath;
            } catch (error) {
                logger.warn(`Failed to download image for expense ID ${expense.id}: ${error.message}`);
                expense.local_image_path = null;
            }
        });

    await Promise.all(downloadPromises);
};

const createZipArchive = async (filesAndDirs, zipFilePath) => {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        output.on('close', () => {
            resolve();
        });

        archive.on('error', (err) => {
            reject(err);
        });

        archive.pipe(output);

        filesAndDirs.forEach(item => {
            const itemPath = path.resolve(item);
            if (fs.existsSync(itemPath)) {
                const stats = fs.statSync(itemPath);
                if (stats.isFile()) {
                    archive.file(itemPath, { name: path.basename(itemPath) });
                } else if (stats.isDirectory()) {
                    archive.directory(itemPath, path.basename(itemPath));
                }
            } else {
                logger.warn(`File or directory ${itemPath} does not exist and will be skipped.`);
            }
        });

        archive.finalize();
    });
};

module.exports = {
    downloadImages,
    createZipArchive
};
