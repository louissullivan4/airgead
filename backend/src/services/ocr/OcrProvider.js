/**
 * OcrProvider — the receipt-OCR seam interface.
 *
 * Phase 2 builds this seam but does NOT rely on it: the live flow runs with OCR
 * disabled (OCR_PROVIDER=none). It exists so switching OCR on later is a config
 * change, not a rebuild. The only concrete implementation today is the mock
 * (MockOcrProvider); HostedOcrProvider is an inert stub.
 *
 * Implementations must expose:
 *
 *   async extract(imageBuffer) -> {
 *     merchant: string | null,
 *     date: string | null,            // ISO yyyy-mm-dd
 *     total: number | null,
 *     tax: number | null,
 *     currency: string | null,
 *     lineItems?: Array<{ description: string, amount: number, category?: string }>,
 *     raw: any,                        // provider's raw response (audit/reprocess)
 *     fieldConfidence: {               // 0..1 per field, drives the (dormant) UI
 *       merchant?: number, date?: number, total?: number, tax?: number, currency?: number
 *     }
 *   }
 *
 * `lineItems` is what lets one receipt fan out into multiple expense rows in the
 * future auto-fill flow; it is optional and may be omitted/empty.
 */
class OcrProvider {
    // eslint-disable-next-line no-unused-vars
    async extract(imageBuffer) {
        throw new Error('OcrProvider.extract() must be implemented by a subclass.');
    }
}

module.exports = OcrProvider;
