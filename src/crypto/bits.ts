/**
 * Bit vectors, one bit per byte.
 *
 * Every word in this lab is at most 255 bits, so a `Uint8Array` holding 0 or 1
 * per element costs nothing and keeps the teaching code readable: `w[i]` is
 * cell i, XOR is a loop, Hamming weight is a sum. The alternative — packed
 * words with shifts and masks — would hide exactly the arithmetic this lab
 * exists to show.
 *
 * Index convention, used everywhere: `b[i]` is the coefficient of x^i. Position
 * 0 is the low-order end of the polynomial, and the systematic encoder puts
 * parity there and the message in the high positions.
 */

export type BitVec = Uint8Array;

export function zeros(n: number): BitVec {
  return new Uint8Array(n);
}

/** Bitwise XOR. Throws on a length mismatch rather than silently truncating. */
export function xor(a: BitVec, b: BitVec): BitVec {
  if (a.length !== b.length) {
    throw new Error(`xor length mismatch: ${a.length} vs ${b.length}`);
  }
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] ^ b[i]) & 1;
  return out;
}

/** Hamming weight. */
export function weight(a: BitVec): number {
  let w = 0;
  for (let i = 0; i < a.length; i++) w += a[i] & 1;
  return w;
}

/** Hamming distance. */
export function distance(a: BitVec, b: BitVec): number {
  if (a.length !== b.length) {
    throw new Error(`distance length mismatch: ${a.length} vs ${b.length}`);
  }
  let d = 0;
  for (let i = 0; i < a.length; i++) d += (a[i] ^ b[i]) & 1;
  return d;
}

export function equal(a: BitVec, b: BitVec): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if ((a[i] & 1) !== (b[i] & 1)) return false;
  return true;
}

/** The indices where two vectors differ, in ascending order. */
export function differingPositions(a: BitVec, b: BitVec): number[] {
  const out: number[] = [];
  for (let i = 0; i < a.length; i++) if ((a[i] ^ b[i]) & 1) out.push(i);
  return out;
}

/** Build a bit vector from an integer, LSB at index 0. For small words only. */
export function fromInt(value: number, n: number): BitVec {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (value >>> i) & 1;
  return out;
}

/** Inverse of `fromInt`. Only valid for n <= 31. */
export function toInt(bits: BitVec): number {
  let v = 0;
  for (let i = bits.length - 1; i >= 0; i--) v = (v << 1) | (bits[i] & 1);
  return v >>> 0;
}

/**
 * Pack bits into bytes for the KDF, MSB-first within each byte, index 0 first.
 *
 * The packing is part of the key derivation, so it is fixed here and named in
 * the UI rather than left implicit: bit i lands in byte `i >> 3` at position
 * `7 - (i & 7)`, and a final partial byte is zero-padded on the right. Two
 * source words that differ produce different byte strings, which is all the
 * derivation needs from it.
 */
export function packBits(bits: BitVec): Uint8Array {
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] & 1) out[i >> 3] |= 0x80 >> (i & 7);
  }
  return out;
}

/** `packBits` inverted, given the original bit length. */
export function unpackBits(bytes: Uint8Array, n: number): BitVec {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string): Uint8Array {
  const clean = hex.trim().replace(/\s+/g, '');
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error(`not hex: ${hex.slice(0, 32)}`);
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A bit vector rendered as its own 0/1 string, index 0 leftmost. */
export function toBitString(bits: BitVec): string {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += bits[i] & 1 ? '1' : '0';
  return s;
}

/** Hex of a bit vector, via `packBits`. Used for the compact public readouts. */
export function bitsToHex(bits: BitVec): string {
  return toHex(packBits(bits));
}
