const storage = require('./storage');

// Generate a short-lived signed URL for a private receipt object. Delegates to
// the active storage driver (local /files token or GCS V4 signed URL).
// `objectPath` is the stored object key (e.g. "org_<id>/2026/<receiptId>.jpg"
// or a legacy "ids/<filename>.jpg"). Defaults to a 5-minute TTL.
const getSignedUrl = (objectPath, ttlSeconds = 300) => {
    if (!objectPath) {
        throw new Error('objectPath is required to sign a URL.');
    }
    return storage.getSignedUrl(objectPath, ttlSeconds);
};

module.exports = { getSignedUrl };
