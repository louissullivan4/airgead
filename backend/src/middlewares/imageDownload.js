require('dotenv').config();

const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

// Convert a stored receipt reference into a storage object key. New rows store
// the object key directly (e.g. "org_<id>/2026/abc.jpg" or legacy "ids/abc.jpg").
// Pre-migration-004 rows still hold a full public URL; strip the scheme/host/
// bucket prefix to recover the object key.
const toObjectPath = (stored) => {
    if (/^https?:\/\//.test(stored)) {
        const withoutQuery = stored.split('?')[0];
        return withoutQuery.replace(/^https?:\/\/storage\.googleapis\.com\/[^/]+\//, '');
    }
    return stored;
};

const downloadImages = async (expenses, imagesDir) => {
    await fs.ensureDir(imagesDir);

    const downloadPromises = expenses
        .filter(expense => expense.receipt_image_url)
        .map(async (expense) => {
            const objectPath = toObjectPath(expense.receipt_image_url);

            const imageExtension = path.extname(objectPath) || '.jpg';
            const imageName = `expense_${expense.id}${imageExtension}`;
            const imagePath = path.join(imagesDir, imageName);

            try {
                const exists = await storage.exists(objectPath);
                if (!exists) {
                    logger.warn(`Receipt ${objectPath} does not exist in storage.`);
                    expense.local_image_path = null;
                    return;
                }

                const readStream = storage.createReadStream(objectPath);

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
