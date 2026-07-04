require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const jwt = require('jsonwebtoken');
const logger = require('./logger');

// Storage abstraction for receipt images. Two interchangeable drivers, selected
// by STORAGE_DRIVER:
//   - 'local' (default): images live on disk under LOCAL_STORAGE_DIR
//     (backend/temp/receipts), served back through short-lived signed /files
//     tokens. No cloud credentials required - ideal for local dev.
//   - 'gcs': Google Cloud Storage (private objects + V4 signed URLs) for prod.
//
// Both drivers store and return the SAME object key (e.g. "org_3/2026/abc.jpg"),
// so the `expenses.receipt_image_url` column is backend-agnostic and rows can
// move between drivers without rewriting.

const DRIVER = (process.env.STORAGE_DRIVER || 'local').toLowerCase();

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR
    || path.join(__dirname, '..', '..', 'temp', 'receipts');
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || 'http://localhost:8080').replace(/\/$/, '');

// ---- local (filesystem) driver ------------------------------------------

// Resolve an object key to an absolute path, refusing anything that escapes the
// storage root (path-traversal guard for token-supplied keys).
const localPathFor = (objectPath) => {
    const root = path.resolve(LOCAL_STORAGE_DIR);
    const full = path.resolve(root, String(objectPath));
    const relative = path.relative(root, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Invalid object path.');
    }
    return full;
};

const local = {
    async putObject(objectPath, buffer /* , contentType */) {
        const dest = localPathFor(objectPath);
        await fs.ensureDir(path.dirname(dest));
        await fs.writeFile(dest, buffer);
    },
    async exists(objectPath) {
        return fs.pathExists(localPathFor(objectPath));
    },
    async deleteObject(objectPath) {
        await fs.remove(localPathFor(objectPath));
    },
    createReadStream(objectPath) {
        return fs.createReadStream(localPathFor(objectPath));
    },
    // Mirror GCS signed URLs: a token embedding the object key + expiry, served
    // by the public GET /files/:token route (see fileController.js).
    async getSignedUrl(objectPath, ttlSeconds = 300) {
        const token = jwt.sign({ obj: objectPath }, process.env.JWT_SECRET, { expiresIn: ttlSeconds });
        return `${PUBLIC_BACKEND_URL}/files/${token}`;
    },
};

// ---- gcs driver ---------------------------------------------------------
// Required lazily so a missing GOOGLE_CLOUD_STORAGE_BUCKET never crashes the
// local/test path.

const gcs = {
    async putObject(objectPath, buffer, contentType) {
        await require('./gcs').getBucket().file(objectPath)
            .save(buffer, { contentType, resumable: false });
    },
    async exists(objectPath) {
        const [ok] = await require('./gcs').getBucket().file(objectPath).exists();
        return ok;
    },
    async deleteObject(objectPath) {
        await require('./gcs').getBucket().file(objectPath).delete({ ignoreNotFound: true });
    },
    createReadStream(objectPath) {
        return require('./gcs').getBucket().file(objectPath).createReadStream();
    },
    async getSignedUrl(objectPath, ttlSeconds = 300) {
        const [url] = await require('./gcs').getBucket().file(objectPath).getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + ttlSeconds * 1000,
        });
        return url;
    },
};

const driver = DRIVER === 'gcs' ? gcs : local;

logger.info(DRIVER === 'gcs'
    ? 'Storage driver: gcs'
    : `Storage driver: local (${path.resolve(LOCAL_STORAGE_DIR)})`);

module.exports = {
    putObject: driver.putObject,
    exists: driver.exists,
    deleteObject: driver.deleteObject,
    createReadStream: driver.createReadStream,
    getSignedUrl: driver.getSignedUrl,
    DRIVER,
    LOCAL_STORAGE_DIR,
};
