const crypto = require('crypto');

// AES-256-GCM at-rest encryption for third-party OAuth tokens (first consumer:
// the Sage connection). Keyed by TOKEN_ENCRYPTION_KEY - 64 hex chars (32
// bytes), generated with `openssl rand -hex 32`. The key is read from the env
// on every call (like isBillingEnforced) so tests and long-lived processes see
// changes. Payload format: "v1:<iv b64>:<authTag b64>:<ciphertext b64>" - the
// version prefix leaves room for a dual-key rotation scheme later.

const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const IV_BYTES = 12; // GCM standard nonce size

const isConfigured = () => KEY_PATTERN.test(process.env.TOKEN_ENCRYPTION_KEY || '');

const getKey = () => {
    const hex = process.env.TOKEN_ENCRYPTION_KEY || '';
    if (!KEY_PATTERN.test(hex)) {
        throw new Error('TOKEN_ENCRYPTION_KEY is not configured (expected 64 hex characters).');
    }
    return Buffer.from(hex, 'hex');
};

const encrypt = (plaintext) => {
    const key = getKey();
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(':');
};

const decrypt = (payload) => {
    const key = getKey();
    const parts = String(payload).split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('Unrecognised encrypted token payload.');
    }
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    // Throws on a wrong key or tampered ciphertext (GCM auth failure).
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
};

module.exports = { encrypt, decrypt, isConfigured };
