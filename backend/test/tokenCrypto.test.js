/* eslint-disable no-undef */
const { expect } = require('@jest/globals');

const tokenCrypto = require('../src/utils/tokenCrypto');

const GOOD_KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
});

describe('tokenCrypto (AES-256-GCM at-rest encryption)', () => {
    it('round-trips a value under a valid key', () => {
        process.env.TOKEN_ENCRYPTION_KEY = GOOD_KEY;
        const payload = tokenCrypto.encrypt('refresh-token-secret');
        expect(payload.startsWith('v1:')).toBe(true);
        expect(payload).not.toContain('refresh-token-secret');
        expect(tokenCrypto.decrypt(payload)).toBe('refresh-token-secret');
    });

    it('isConfigured() is false when the key is unset, short, or non-hex', () => {
        expect(tokenCrypto.isConfigured()).toBe(false);
        process.env.TOKEN_ENCRYPTION_KEY = 'abc123';
        expect(tokenCrypto.isConfigured()).toBe(false);
        process.env.TOKEN_ENCRYPTION_KEY = 'z'.repeat(64);
        expect(tokenCrypto.isConfigured()).toBe(false);
        process.env.TOKEN_ENCRYPTION_KEY = GOOD_KEY;
        expect(tokenCrypto.isConfigured()).toBe(true);
    });

    it('encrypt throws when unconfigured', () => {
        expect(() => tokenCrypto.encrypt('secret')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    });

    it('decrypt throws when the key changed since encryption', () => {
        process.env.TOKEN_ENCRYPTION_KEY = GOOD_KEY;
        const payload = tokenCrypto.encrypt('secret');
        process.env.TOKEN_ENCRYPTION_KEY = OTHER_KEY;
        expect(() => tokenCrypto.decrypt(payload)).toThrow();
    });

    it('decrypt rejects tampered ciphertext and unknown payload versions', () => {
        process.env.TOKEN_ENCRYPTION_KEY = GOOD_KEY;
        const payload = tokenCrypto.encrypt('secret');
        const parts = payload.split(':');
        // Flip the ciphertext: the GCM auth tag must catch it.
        const tampered = [parts[0], parts[1], parts[2], Buffer.from('tampered!').toString('base64')].join(':');
        expect(() => tokenCrypto.decrypt(tampered)).toThrow();
        expect(() => tokenCrypto.decrypt(payload.replace(/^v1/, 'v2'))).toThrow(/Unrecognised/);
    });

    it('two encryptions of the same plaintext differ (random IV)', () => {
        process.env.TOKEN_ENCRYPTION_KEY = GOOD_KEY;
        expect(tokenCrypto.encrypt('same')).not.toBe(tokenCrypto.encrypt('same'));
    });
});
