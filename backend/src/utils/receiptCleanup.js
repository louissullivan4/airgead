const sharp = require('sharp');
const logger = require('../utils/logger');

// Phase 2 receipt image cleanup. Pipeline position:
//   capture -> [perspective crop: deferred] -> compress -> store
//
// What gets STORED is a normal, legible image: the original photo, auto-oriented,
// size-bounded, and re-encoded to a compressed JPEG. Image formats are already
// "compress on store / decompress on view" — any viewer or browser decompresses
// the JPEG transparently on download, so the user sees the real receipt.
//
// NOTE: we intentionally do NOT store a binarised (1-bit black/white) image.
// Binarisation is destructive — it permanently discards the grey detail — so it
// is only ever used as a throwaway input for OCR (see `binarise` below), never
// as the thing we keep and serve back to the user.

// Cap the long edge so a 12MP phone photo doesn't bloat storage while staying
// easily legible for a tax record. ~2200px keeps small print readable.
const MAX_EDGE = 2200;
const JPEG_QUALITY = 85;

// Conservative default threshold (0-255) for the OCR-only binarisation path.
const DEFAULT_THRESHOLD = 140;

// TODO: perspective crop (OpenCV findContours + warpPerspective, or a Python
// sidecar) — deferred to avoid a finicky native dependency on the node:20-alpine
// image. When added, detect the largest 4-point convex receipt contour and
// deskew; if no confident quad is found, pass the full frame through unchanged
// (a missed crop beats one that cuts off the total). Until then this is a no-op
// seam so the call site / return shape stay stable.
const cropReceipt = async (buffer) => {
    return { buffer, cropped: false };
};

// Compress the captured photo to a legible, size-bounded JPEG for storage.
// `.rotate()` (no args) auto-orients from EXIF — important for phone captures.
const compress = async (buffer) => {
    return sharp(buffer)
        .rotate()
        .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
};

// Grayscale + threshold to a 1-bit black/white PNG. DESTRUCTIVE — for OCR input
// only (dormant today); never stored as the user-facing receipt.
const binarise = async (buffer, threshold = DEFAULT_THRESHOLD) => {
    return sharp(buffer)
        .rotate()
        .greyscale()
        .normalise()
        .threshold(threshold)
        .png({ compressionLevel: 9, palette: true, colours: 2 })
        .toBuffer();
};

// Clean a captured receipt image for storage. Returns the compressed image
// buffer plus the content type / extension to store it under, and whether a
// perspective crop was applied (always false for now).
const cleanReceipt = async (inputBuffer) => {
    if (!inputBuffer || inputBuffer.length === 0) {
        throw new Error('cleanReceipt requires a non-empty image buffer.');
    }
    try {
        const { buffer: croppedBuffer, cropped } = await cropReceipt(inputBuffer);
        const imageBuffer = await compress(croppedBuffer);
        logger.info('Receipt cleaned', {
            inputBytes: inputBuffer.length,
            outputBytes: imageBuffer.length,
            cropped,
        });
        return { imageBuffer, contentType: 'image/jpeg', ext: 'jpg', cropped };
    } catch (error) {
        logger.error('Error cleaning receipt image', { error: error.message });
        throw error;
    }
};

module.exports = {
    cleanReceipt,
    binarise,
    DEFAULT_THRESHOLD,
    MAX_EDGE,
    JPEG_QUALITY,
};
