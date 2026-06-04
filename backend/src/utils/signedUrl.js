const { getBucket } = require('./gcs');

// Task 6: generate a short-lived V4 signed URL for a private GCS object.
// `objectPath` is the stored object key (e.g. "org_<id>/2026/<receiptId>.jpg"
// or a legacy "ids/<filename>.jpg"). Defaults to a 5-minute TTL.
const getSignedUrl = async (objectPath, ttlSeconds = 300) => {
    if (!objectPath) {
        throw new Error('objectPath is required to sign a URL.');
    }
    const [url] = await getBucket()
        .file(objectPath)
        .getSignedUrl({
            version: 'v4',
            action: 'read',
            expires: Date.now() + ttlSeconds * 1000,
        });
    return url;
};

module.exports = { getSignedUrl };
