const OcrProvider = require('./OcrProvider');

// MockOcrProvider - the only OCR implementation built in Phase 2. It returns
// canned-but-plausible data with fake confidence scores so the auto-fill seam
// (and its dormant frontend UI) can be developed and tested end-to-end WITHOUT
// calling - or paying for - any real OCR provider.
//
// It is never reached by the live flow while OCR_PROVIDER=none. Flip the env to
// 'mock' to exercise the dormant auto-fill path locally.
class MockOcrProvider extends OcrProvider {
    // eslint-disable-next-line no-unused-vars
    async extract(imageBuffer) {
        const today = new Date().toISOString().slice(0, 10);
        return {
            merchant: 'The Corner Cafe',
            date: today,
            total: 14.40,
            tax: 1.87,
            currency: 'EUR',
            lineItems: [
                { description: 'Flat white', amount: 3.60, category: 'meals' },
                { description: 'Lunch special', amount: 10.80, category: 'meals' },
            ],
            raw: { provider: 'mock', note: 'canned data - no real OCR performed' },
            fieldConfidence: {
                merchant: 0.96,
                date: 0.91,
                total: 0.88,
                tax: 0.62, // deliberately low to exercise the low-confidence UI
                currency: 0.99,
            },
        };
    }
}

module.exports = MockOcrProvider;
