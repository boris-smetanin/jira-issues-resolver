import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto.js';
import { withMasterKey } from '../__test__/withMasterKey.js';

// Slice 0013: Core 4 — Crypto tests.
//
// The crypto module is the security primitive for all stored
// credentials (agent API keys, GitHub tokens, Jira tokens, npmrc env
// values). A failure here silently corrupts every credential at rest,
// so the tests cover round-trip, tamper resistance, wrong-key, and
// key-length validation.
//
// Note on key-length validation timing: the issue spec called for
// validation at module import. The actual module is lazy — `getKey()`
// is called on every encrypt/decrypt, throwing on bad MASTER_KEY at
// call time. Tests target the actual behavior. Functionally
// equivalent for our use case (server bootstrap calls crypto early,
// so a bad key still surfaces at startup).

const validKey = randomBytes(32).toString('base64');
const otherKey = randomBytes(32).toString('base64');

describe('crypto round-trip', () => {
  it('encrypts and decrypts an empty string', () => {
    withMasterKey(validKey, () => {
      expect(decrypt(encrypt(''))).toBe('');
    });
  });

  it('encrypts and decrypts a short string', () => {
    withMasterKey(validKey, () => {
      expect(decrypt(encrypt('hello'))).toBe('hello');
    });
  });

  it('encrypts and decrypts a long string (10 KB)', () => {
    withMasterKey(validKey, () => {
      const long = 'x'.repeat(10_000);
      expect(decrypt(encrypt(long))).toBe(long);
    });
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    withMasterKey(validKey, () => {
      const a = encrypt('same');
      const b = encrypt('same');
      expect(a).not.toBe(b);
      // Both still decrypt cleanly.
      expect(decrypt(a)).toBe('same');
      expect(decrypt(b)).toBe('same');
    });
  });
});

describe('crypto tamper detection', () => {
  // IV_LENGTH=12, TAG_LENGTH=16. Layout in base64-decoded buffer:
  // [0..12) IV, [12..28) tag, [28..) ciphertext.
  function tamperAt(byteIndex: number): string {
    const original = encrypt('payload');
    const buf = Buffer.from(original, 'base64');
    buf[byteIndex] = (buf[byteIndex]! ^ 0x01) & 0xff;
    return buf.toString('base64');
  }

  it('throws when a byte in the IV is flipped', () => {
    withMasterKey(validKey, () => {
      const tampered = tamperAt(0);
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  it('throws when a byte in the auth tag is flipped', () => {
    withMasterKey(validKey, () => {
      const tampered = tamperAt(12);
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  it('throws when a byte in the ciphertext is flipped', () => {
    withMasterKey(validKey, () => {
      const tampered = tamperAt(28);
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  it('throws when ciphertext is too short to contain IV+tag', () => {
    withMasterKey(validKey, () => {
      const tooShort = Buffer.alloc(10).toString('base64');
      expect(() => decrypt(tooShort)).toThrow(/too short/);
    });
  });
});

describe('crypto wrong-key detection', () => {
  it('throws when decrypting with a different key', () => {
    const ct = withMasterKey(validKey, () => encrypt('secret'));
    withMasterKey(otherKey, () => {
      expect(() => decrypt(ct)).toThrow();
    });
  });
});

describe('crypto key-length validation', () => {
  it('throws when MASTER_KEY decodes to 31 bytes (one short)', () => {
    withMasterKey(randomBytes(31).toString('base64'), () => {
      expect(() => encrypt('x')).toThrow(/32 bytes/);
    });
  });

  it('throws when MASTER_KEY decodes to 33 bytes (one long)', () => {
    withMasterKey(randomBytes(33).toString('base64'), () => {
      expect(() => encrypt('x')).toThrow(/32 bytes/);
    });
  });

  it('throws when MASTER_KEY is missing entirely', () => {
    withMasterKey(undefined, () => {
      expect(() => encrypt('x')).toThrow(/MASTER_KEY is not set/);
    });
  });
});
