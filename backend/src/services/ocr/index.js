const logger = require('../../utils/logger');
const MockOcrProvider = require('./MockOcrProvider');
const HostedOcrProvider = require('./HostedOcrProvider');

// OCR provider factory. Reads OCR_PROVIDER (default 'none'):
//   'none'   -> returns null. OCR is fully disabled; callers must skip OCR
//               entirely (no provider constructed, no extract() call). This is
//               the Phase 2 shipping default.
//   'mock'   -> MockOcrProvider (canned data; for developing the dormant path).
//   'hosted' -> HostedOcrProvider (throws NotImplemented until a vendor is wired).
//
// Returning null for 'none' (rather than a no-op provider) makes the disabled
// state explicit at every call site: `const ocr = getOcrProvider(); if (ocr) {...}`.
const getOcrProvider = () => {
    const provider = (process.env.OCR_PROVIDER || 'none').toLowerCase();
    switch (provider) {
        case 'none':
            return null;
        case 'mock':
            return new MockOcrProvider();
        case 'hosted':
            return new HostedOcrProvider();
        default:
            logger.warn('Unknown OCR_PROVIDER "%s" - treating OCR as disabled.', provider);
            return null;
    }
};

module.exports = { getOcrProvider };
