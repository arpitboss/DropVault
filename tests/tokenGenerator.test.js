const {
  generateShareToken,
  isTokenValidFormat,
  MIN_TOKEN_BYTES,
} = require('../src/utils/tokenGenerator');

describe('Token Generation Utility (V0-T07)', () => {
  describe('generateShareToken', () => {
    it('should generate a token of length >= 43 for 32 bytes (TOK-1, TOK-2)', () => {
      const token = generateShareToken();
      expect(typeof token).toBe('string');
      // 32 bytes base64url is exactly 43 characters
      expect(token.length).toBe(43);
    });

    it('should produce strictly URL-safe characters with no padding (TOK-5)', () => {
      const token = generateShareToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      // Ensure no base64 standard padding or non-URL-safe characters
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');
      expect(token).not.toContain(' ');
    });

    it('should produce unique tokens on consecutive calls (uniqueness & entropy)', () => {
      const token1 = generateShareToken();
      const token2 = generateShareToken();
      expect(token1).not.toEqual(token2);
    });

    it('should generate 500 unique tokens with zero collisions', () => {
      const count = 500;
      const tokens = new Set();

      for (let i = 0; i < count; i++) {
        tokens.add(generateShareToken());
      }

      expect(tokens.size).toBe(count);
    });

    it('should allow larger byte lengths if requested', () => {
      const largeToken = generateShareToken(64);
      // 64 bytes in base64url is 86 characters
      expect(largeToken.length).toBe(86);
      expect(largeToken).toMatch(/^[A-Za-z0-9_-]{86}$/);
    });

    it('should reject byte lengths below 32 to enforce minimum entropy (TOK-2)', () => {
      expect(() => generateShareToken(16)).toThrow(/at least 32 bytes/i);
      expect(() => generateShareToken(0)).toThrow(/at least 32 bytes/i);
      expect(() => generateShareToken(-1)).toThrow(/at least 32 bytes/i);
      expect(() => generateShareToken('32')).toThrow(/at least 32 bytes/i);
    });
  });

  describe('isTokenValidFormat', () => {
    it('should return true for valid generated tokens', () => {
      const token = generateShareToken();
      expect(isTokenValidFormat(token)).toBe(true);
    });

    it('should return false for tokens that are too short', () => {
      expect(isTokenValidFormat('too-short-token')).toBe(false);
      expect(isTokenValidFormat('')).toBe(false);
    });

    it('should return false for tokens with non-URL-safe characters', () => {
      const validToken = generateShareToken();
      // Inject invalid characters
      expect(isTokenValidFormat(validToken.slice(0, -1) + '+')).toBe(false);
      expect(isTokenValidFormat(validToken.slice(0, -1) + '/')).toBe(false);
      expect(isTokenValidFormat(validToken.slice(0, -1) + '=')).toBe(false);
      expect(isTokenValidFormat(validToken.slice(0, -1) + ' ')).toBe(false);
      expect(isTokenValidFormat(validToken.slice(0, -1) + '?')).toBe(false);
    });

    it('should return false for non-string inputs', () => {
      expect(isTokenValidFormat(null)).toBe(false);
      expect(isTokenValidFormat(undefined)).toBe(false);
      expect(isTokenValidFormat(123456789)).toBe(false);
      expect(isTokenValidFormat({})).toBe(false);
    });
  });
});
