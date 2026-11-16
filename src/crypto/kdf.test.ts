import { describe, expect, it } from 'vitest';
import { fromHex, fromInt, toHex } from './bits';
import { bytesEqual, deriveKey, hkdfSha256, KEY_BYTES, keyContext, sha256OfWord } from './kdf';

/**
 * RFC 5869 Appendix A, the three SHA-256 test cases. Pinned through
 * `hkdfSha256` — the same function the lab derives every key with — so a change
 * to the call path (a wrong hash, a swapped salt and info, a length in bits
 * instead of bytes) fails here rather than producing plausible-looking bytes.
 */
const RFC_5869_SHA256 = [
  {
    name: 'A.1 basic',
    ikm: '0b'.repeat(22),
    salt: '000102030405060708090a0b0c',
    info: 'f0f1f2f3f4f5f6f7f8f9',
    length: 42,
    okm:
      '3cb25f25faacd57a90434f64d0362f2a' +
      '2d2d0a90cf1a5a4c5db02d56ecc4c5bf' +
      '34007208d5b887185865',
  },
  {
    name: 'A.2 longer inputs and output',
    ikm: Array.from({ length: 80 }, (_, i) => i.toString(16).padStart(2, '0')).join(''),
    salt: Array.from({ length: 80 }, (_, i) => (0x60 + i).toString(16).padStart(2, '0')).join(''),
    info: Array.from({ length: 80 }, (_, i) => (0xb0 + i).toString(16).padStart(2, '0')).join(''),
    length: 82,
    okm:
      'b11e398dc80327a1c8e7f78c596a4934' +
      '4f012eda2d4efad8a050cc4c19afa97c' +
      '59045a99cac7827271cb41c65e590e09' +
      'da3275600c2f09b8367793a9aca3db71' +
      'cc30c58179ec3e87c14c01d5c1f3434f' +
      '1d87',
  },
  {
    name: 'A.3 zero-length salt and info',
    ikm: '0b'.repeat(22),
    salt: '',
    info: '',
    length: 42,
    okm:
      '8da4e775a563c18f715f802a063c5a31' +
      'b8a11f5c5ee1879ec3454e5f3c738d2d' +
      '9d201395faa4b61a96c8',
  },
] as const;

describe('HKDF-SHA-256 from WebCrypto', () => {
  it.each(RFC_5869_SHA256.map((v) => [v.name, v] as const))('RFC 5869 %s', async (_name, v) => {
    const okm = await hkdfSha256(fromHex(v.ikm), fromHex(v.salt), fromHex(v.info), v.length);
    expect(toHex(okm)).toBe(v.okm);
    expect(okm.length).toBe(v.length);
  });

  it('is deterministic and separated by salt, info and length', async () => {
    const ikm = fromHex('0b'.repeat(22));
    const a = await hkdfSha256(ikm, fromHex('00'), fromHex('01'), 32);
    const again = await hkdfSha256(ikm, fromHex('00'), fromHex('01'), 32);
    expect(toHex(a)).toBe(toHex(again));
    expect(toHex(await hkdfSha256(ikm, fromHex('01'), fromHex('01'), 32))).not.toBe(toHex(a));
    expect(toHex(await hkdfSha256(ikm, fromHex('00'), fromHex('02'), 32))).not.toBe(toHex(a));
    expect((await hkdfSha256(ikm, fromHex('00'), fromHex('01'), 16)).length).toBe(16);
  });
});

describe('the lab key-derivation step', () => {
  const salt = fromHex('a3e6351122334455');

  it('derives a 32-byte key that depends on every bit of the source word', async () => {
    const base = fromInt(0, 31);
    const key = await deriveKey(base, salt, 'BCH(31, 16), t = 3');
    expect(key.length).toBe(KEY_BYTES);
    for (let i = 0; i < base.length; i++) {
      const flipped = Uint8Array.from(base);
      flipped[i] ^= 1;
      const other = await deriveKey(flipped, salt, 'BCH(31, 16), t = 3');
      expect(bytesEqual(other, key)).toBe(false);
    }
  });

  it('separates keys by code label and by salt', async () => {
    const w = fromInt(0b1011011, 31);
    const a = await deriveKey(w, salt, 'BCH(31, 16), t = 3');
    const b = await deriveKey(w, salt, 'BCH(63, 39), t = 4');
    const c = await deriveKey(w, fromHex('0000000000000000'), 'BCH(31, 16), t = 3');
    expect(bytesEqual(a, b)).toBe(false);
    expect(bytesEqual(a, c)).toBe(false);
  });

  it('names the context string on the page rather than hiding it', () => {
    expect(new TextDecoder().decode(keyContext('BCH(15, 7), t = 2'))).toBe(
      'crypto-lab-drift-key v1 | BCH(15, 7), t = 2 | key',
    );
  });

  it('hashes two readings of the same word to the same digest and different words apart', async () => {
    const w = fromInt(0b1101001, 15);
    expect(toHex(await sha256OfWord(w))).toBe(toHex(await sha256OfWord(Uint8Array.from(w))));
    const other = Uint8Array.from(w);
    other[3] ^= 1;
    expect(toHex(await sha256OfWord(other))).not.toBe(toHex(await sha256OfWord(w)));
  });

  it('changes about HALF the digest bits when one cell flips, never all of them', async () => {
    // The page's "so hash it?" exhibit prints two digests side by side and says
    // what the reader is looking at. A good hash flips each output bit with
    // probability one half, so about 128 of 256 bits differ -- not every bit,
    // which would make the second digest the complement of the first and so
    // perfectly predictable. Measured here over 64 one-cell flips; a 2,000-trial
    // run of the same path gives a mean of 127.9 with a spread of 103 to 156.
    let total = 0;
    for (let trial = 0; trial < 64; trial++) {
      const w = fromInt(trial * 0x5bd1 + 1, 15);
      const flipped = Uint8Array.from(w);
      flipped[trial % 15] ^= 1;
      const [a, b] = await Promise.all([sha256OfWord(w), sha256OfWord(flipped)]);
      let differing = 0;
      for (let i = 0; i < a.length; i++) {
        let x = a[i]! ^ b[i]!;
        while (x) { differing += x & 1; x >>>= 1; }
      }
      expect(differing).toBeGreaterThan(64);
      expect(differing).toBeLessThan(192);
      total += differing;
    }
    expect(total / 64).toBeGreaterThan(112);
    expect(total / 64).toBeLessThan(144);
  });

  it('bytesEqual rejects a length mismatch and a single differing byte', () => {
    expect(bytesEqual(fromHex('0011'), fromHex('0011'))).toBe(true);
    expect(bytesEqual(fromHex('0011'), fromHex('0012'))).toBe(false);
    expect(bytesEqual(fromHex('0011'), fromHex('001100'))).toBe(false);
  });
});
