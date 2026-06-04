require('dotenv').config();
const { Storage } = require('@google-cloud/storage');

// Lazily construct the Storage client and bucket. Doing this at module load
// time crashes when GOOGLE_CLOUD_STORAGE_BUCKET is unset (e.g. in tests), so we
// defer until first use. Both are cached after the first call.
let storage;
let bucket;

const getStorage = () => {
    if (!storage) {
        storage = new Storage({
            projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
            keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        });
    }
    return storage;
};

const getBucket = () => {
    if (!bucket) {
        const name = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
        if (!name) {
            throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET is not configured.');
        }
        bucket = getStorage().bucket(name);
    }
    return bucket;
};

module.exports = { getStorage, getBucket };
