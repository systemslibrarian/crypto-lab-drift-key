import { describe, expect, it } from 'vitest';
import {
  bitsToHex,
  differingPositions,
  distance,
  equal,
  fromHex,
  fromInt,
  packBits,
  toBitString,
  toHex,
  toInt,
  unpackBits,
  weight,
  xor,
} from './bits';

describe('bit vectors', () => {
  it('xors, weighs and measures distance', () => {
    const a = Uint8Array.from([1, 0, 1, 1, 0]);
    const b = Uint8Array.from([1, 1, 0, 1, 0]);
    expect([...xor(a, b)]).toEqual([0, 1, 1, 0, 0]);
    expect(weight(a)).toBe(3);
    expect(distance(a, b)).toBe(2);
    expect(differingPositions(a, b)).toEqual([1, 2]);
    expect(equal(a, a)).toBe(true);
    expect(equal(a, b)).toBe(false);
  });

  it('refuses to xor mismatched lengths instead of truncating', () => {
    expect(() => xor(new Uint8Array(4), new Uint8Array(5))).toThrow(/length mismatch/);
  });

  it('round-trips integers and bit strings', () => {
    for (let v = 0; v < 512; v++) {
      const bits = fromInt(v, 9);
      expect(toInt(bits)).toBe(v);
      expect(toBitString(bits)).toBe(
        v
          .toString(2)
          .padStart(9, '0')
          .split('')
          .reverse()
          .join(''),
      );
    }
  });

  it('packs and unpacks bits MSB-first with zero padding', () => {
    const bits = Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1, 1, 1]);
    const bytes = packBits(bits);
    expect(toHex(bytes)).toBe('b1c0');
    expect([...unpackBits(bytes, bits.length)]).toEqual([...bits]);
  });

  it('gives distinct source words distinct packed bytes', () => {
    const seen = new Map<string, number>();
    for (let v = 0; v < 1 << 12; v++) {
      const hex = bitsToHex(fromInt(v, 12));
      expect(seen.has(hex)).toBe(false);
      seen.set(hex, v);
    }
  });

  it('round-trips hex and rejects malformed input', () => {
    expect(toHex(fromHex('00ff10'))).toBe('00ff10');
    expect(() => fromHex('0f0')).toThrow(/not hex/);
    expect(() => fromHex('zz')).toThrow(/not hex/);
  });
});
