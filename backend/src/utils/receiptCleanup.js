const sharp = require('sharp');
const logger = require('../utils/logger');

// Phase 2 receipt image cleanup. Pipeline position:
//   capture -> [perspective crop: deferred] -> binarise -> compress -> store
//
// The cleaned image is what gets STORED — that's the cost win: a 1-bit black/
// white PNG of a thermal receipt is a fraction of the size of the colour photo,
// and lossless (never JPEG for B&W text). See storage.js for where it lands.

// Conservative default threshold (0-255). Lower keeps faint thermal text at the
// cost of more background speckle; higher cleans the background but can drop
// light strokes. Tunable here (and overridable per-call).
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

// Grayscale + adaptive-ish threshold to a 1-bit black/white PNG.
// `.rotate()` (no args) auto-orients from EXIF — important for phone captures.
const binarise = async (buffer, threshold = DEFAULT_THRESHOLD) => {
    return sharp(buffer)
        .rotate()
        .greyscale()
        .normalise()
        .median(1) // light denoise to kill isolated speckle before thresholding
        .threshold(threshold)
        .png({ compressionLevel: 9, palette: true, colours: 2 })
        .toBuffer();
};

// Clean a captured receipt image. Returns the binarised PNG buffer ready to
// store, plus whether a perspective crop was applied (always false for now).
const cleanReceipt = async (inputBuffer, { threshold } = {}) => {
    if (!inputBuffer || inputBuffer.length === 0) {
        throw new Error('cleanReceipt requires a non-empty image buffer.');
    }
    try {
        const { buffer: croppedBuffer, cropped } = await cropReceipt(inputBuffer);
        const binarisedBuffer = await binarise(croppedBuffer, threshold);
        logger.info('Receipt cleaned', {
            inputBytes: inputBuffer.length,
            outputBytes: binarisedBuffer.length,
            cropped,
        });
        return { binarisedBuffer, cropped };
    } catch (error) {
        logger.error('Error cleaning receipt image', { error: error.message });
        throw error;
    }
};

module.exports = {
    cleanReceipt,
    DEFAULT_THRESHOLD,
};
