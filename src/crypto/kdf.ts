/**
 * HKDF-SHA-256, from WebCrypto. Not hand-rolled (invariant I2).
 *
 * The fuzzy-extractor literature specifies a strong randomness extractor here —
 * DORS instantiate it with universal hashing and the leftover hash lemma, which
 * gives an information-theoretic statement about the output's distance from
 * uniform. HKDF is the practical choice a real device would ship and is what
 * this lab uses, so the two rest on different assumptions. The page and the
 * README both say so rather than letting "extractor" and "KDF" blur together.
 *
 * `kdf.test.ts` pins all three RFC 5869 SHA-256 vectors through this exact call
 * path, so the vectors check what the lab actually calls, not a parallel
 * implementation written to satisfy them.
 */

import { type BitVec, packBits } from './bits';

export const KEY_BYTES = 32;

/** The HKDF `info` string. Fixed, public, and printed on the page. */
export function keyContext(codeLabel: string): Uint8Array {
  return new TextEncoder().encode(`crypto-lab-drift-key v1 | ${codeLabel} | key`);
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto SubtleCrypto is unavailable; this lab needs a secure context');
  }
  return c.subtle;
}

/** HKDF-SHA-256 extract-and-expand, exactly as WebCrypto performs it. */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * The lab's key-derivation step: pack the source word into bytes (see
 * `packBits` for the fixed convention), then HKDF it under a public salt and a
 * public context string.
 *
 * The salt is published alongside the helper data, because the extractor seed
 * in the DORS construction is public too. Nothing secret enters here except the
 * source word itself.
 */
export async function deriveKey(
  sourceWord: BitVec,
  salt: Uint8Array,
  codeLabel: string,
): Promise<Uint8Array> {
  return hkdfSha256(packBits(sourceWord), salt, keyContext(codeLabel), KEY_BYTES);
}

/** SHA-256 of a packed source word — Act 2's "why hashing alone fails" exhibit. */
export async function sha256OfWord(sourceWord: BitVec): Promise<Uint8Array> {
  const digest = await subtle().digest('SHA-256', packBits(sourceWord) as BufferSource);
  return new Uint8Array(digest);
}

/** Constant-time-ish byte comparison. Length is public here; contents are not. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
