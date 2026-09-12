const crypto = require('crypto');

const MIN_TOKEN_BYTES = 32; // 256 bits of cryptographic entropy (TOK-2)
const BASE64URL_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Generates a cryptographically secure, high-entropy, opaque share token (TOK-1..5).
 * Encoded as URL-safe base64 without padding (base64url).
 * 32 bytes yields exactly 43 characters of high-entropy URL-safe text.
 *
 * @param {number} [byteLength=32] - Number of random bytes (minimum 32 bytes)
 * @returns {string} High-entropy URL-safe token
 */
const generateShareToken = (byteLength = MIN_TOKEN_BYTES) => {
  if (typeof byteLength !== 'number' || byteLength < MIN_TOKEN_BYTES) {
    throw new Error(
      `Token byteLength must be at least ${MIN_TOKEN_BYTES} bytes to preserve high entropy (TOK-2)`
    );
  }

  // TOK-1: Cryptographically secure random bytes
  // TOK-3: Completely opaque — no IDs, timestamps, or metadata embedded
  return crypto.randomBytes(byteLength).toString('base64url');
};

/**
 * Validates whether a given token conforms to the expected URL-safe format and length.
 * @param {string} token - Candidate token string
 * @param {number} [minByteLength=32] - Expected minimum byte length
 * @returns {boolean}
 */
const isTokenValidFormat = (token, minByteLength = MIN_TOKEN_BYTES) => {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // In base64url, 32 bytes produces ceil(32 * 4 / 3) = 43 characters
  const minCharLength = Math.ceil((minByteLength * 4) / 3);

  if (token.length < minCharLength) {
    return false;
  }

  return BASE64URL_REGEX.test(token);
};

module.exports = {
  generateShareToken,
  isTokenValidFormat,
  MIN_TOKEN_BYTES,
};
