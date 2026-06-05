/* eslint-disable no-undef */
const sharp = require('sharp');
const { expect } = require('@jest/globals');

const { cleanReceipt, binarise } = require('../src/utils/receiptCleanup');
const { getOcrProvider } = require('../src/services/ocr');
const MockOcrProvider = require('../src/services/ocr/MockOcrProvider');

// A small synthetic colour image to feed the cleanup pipeline.
const makeTestImage = () =>
    sharp({
        create: { width: 64, height: 96, channels: 3, background: { r: 200, g: 200, b: 200 } },
    })
        .png()
        .toBuffer();

describe('receiptCleanup.cleanReceipt', () => {
    it('returns a compressed JPEG image buffer and cropped:false (crop deferred)', async () => {
        const input = await makeTestImage();
        const { imageBuffer, contentType, ext, cropped } = await cleanReceipt(input);

        expect(Buffer.isBuffer(imageBuffer)).toBe(true);
        expect(imageBuffer.length).toBeGreaterThan(0);
        expect(contentType).toBe('image/jpeg');
        expect(ext).toBe('jpg');
        expect(cropped).toBe(false);

        // Stored image is a legible (not binarised) JPEG — decompresses for the
        // user automatically on view/download.
        const meta = await sharp(imageBuffer).metadata();
        expect(meta.format).toBe('jpeg');
    });

    it('throws on an empty buffer', async () => {
        await expect(cleanReceipt(Buffer.alloc(0))).rejects.toThrow();
    });
});

describe('receiptCleanup.binarise (OCR-only, not stored)', () => {
    it('produces a 1-bit PNG for OCR input', async () => {
        const input = await makeTestImage();
        const out = await binarise(input);
        const meta = await sharp(out).metadata();
        expect(meta.format).toBe('png');
    });
});

describe('getOcrProvider factory', () => {
    const original = process.env.OCR_PROVIDER;
    afterEach(() => {
        if (original === undefined) delete process.env.OCR_PROVIDER;
        else process.env.OCR_PROVIDER = original;
    });

    it('returns null when OCR_PROVIDER is unset (OCR disabled by default)', () => {
        delete process.env.OCR_PROVIDER;
        expect(getOcrProvider()).toBeNull();
    });

    it('returns null for "none"', () => {
        process.env.OCR_PROVIDER = 'none';
        expect(getOcrProvider()).toBeNull();
    });

    it('returns a MockOcrProvider for "mock"', () => {
        process.env.OCR_PROVIDER = 'mock';
        expect(getOcrProvider()).toBeInstanceOf(MockOcrProvider);
    });

    it('returns null for an unknown provider', () => {
        process.env.OCR_PROVIDER = 'wat';
        expect(getOcrProvider()).toBeNull();
    });
});

describe('MockOcrProvider.extract', () => {
    it('returns the documented OcrProvider shape', async () => {
        const result = await new MockOcrProvider().extract(Buffer.from('x'));

        expect(result).toEqual(
            expect.objectContaining({
                merchant: expect.any(String),
                date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                total: expect.any(Number),
                tax: expect.any(Number),
                currency: expect.any(String),
                raw: expect.any(Object),
                fieldConfidence: expect.any(Object),
            }),
        );
        expect(Array.isArray(result.lineItems)).toBe(true);
        expect(result.lineItems.length).toBeGreaterThan(0);
        result.lineItems.forEach((li) => {
            expect(li).toEqual(
                expect.objectContaining({ description: expect.any(String), amount: expect.any(Number) }),
            );
        });
    });
});
