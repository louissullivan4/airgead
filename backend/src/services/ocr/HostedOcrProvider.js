const OcrProvider = require('./OcrProvider');

// HostedOcrProvider — inert stub for the future hosted-OCR integration. It is
// wired into the factory (OCR_PROVIDER=hosted) but throws until implemented, so
// the integration point is obvious without committing to a vendor or shipping a
// dependency we don't yet use.
//
// Candidate vendors (EU data residency is a hard requirement — receipts contain
// personal/tax data):
//   - Veryfi
//   - Tabscanner
//   - Eagle Doc
//   - Azure Document Intelligence (prebuilt receipt model)
//
// When implemented, map the vendor response onto the OcrProvider contract
// (merchant/date/total/tax/currency/lineItems/raw/fieldConfidence) and read the
// API key from env (never commit it). Keep `raw` so results can be reprocessed.
class HostedOcrProvider extends OcrProvider {
    // eslint-disable-next-line no-unused-vars
    async extract(imageBuffer) {
        const err = new Error('HostedOcrProvider.extract() is not implemented yet.');
        err.code = 'NotImplemented';
        throw err;
    }
}

module.exports = HostedOcrProvider;
