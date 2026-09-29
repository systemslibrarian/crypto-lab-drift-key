import { describe, expect, it } from 'vitest';
import { alphaPow, gfDiv, gfInv, gfMul, gfMulReference, makeGF, PRIMITIVE_POLY } from './gf2m';

const DEGREES = [3, 4, 5, 6, 7, 8];

describe('GF(2^m)', () => {
  it.each(DEGREES)('alpha is primitive in GF(2^%i)', (m) => {
    const gf = makeGF(m);
    // Order exactly 2^m - 1: every nonzero element appears once among alpha^0..alpha^(n-1).
    const seen = new Set<number>();
    for (let i = 0; i < gf.n; i++) seen.add(gf.exp[i]);
    expect(seen.size).toBe(gf.n);
    expect(seen.has(0)).toBe(false);
    expect(alphaPow(gf, gf.n)).toBe(1);
  });

  it.each(DEGREES)('exp and log invert each other in GF(2^%i)', (m) => {
    const gf = makeGF(m);
    for (let i = 0; i < gf.n; i++) expect(gf.log[gf.exp[i]]).toBe(i);
    for (let x = 1; x <= gf.n; x++) expect(gf.exp[gf.log[x]]).toBe(x);
  });

  it.each(DEGREES)(
    'table multiplication agrees with carry-less multiply-and-reduce in GF(2^%i)',
    (m) => {
      const gf = makeGF(m);
      const poly = PRIMITIVE_POLY[m];
      for (let a = 0; a < 1 << m; a++) {
        for (let b = 0; b < 1 << m; b++) {
          expect(gfMul(gf, a, b)).toBe(gfMulReference(poly, m, a, b));
        }
      }
    },
  );

  it.each(DEGREES)('inverse and division are consistent in GF(2^%i)', (m) => {
    const gf = makeGF(m);
    for (let a = 1; a < 1 << m; a++) {
      expect(gfMul(gf, a, gfInv(gf, a))).toBe(1);
      for (let b = 1; b < 1 << m; b++) {
        expect(gfMul(gf, gfDiv(gf, a, b), b)).toBe(a);
      }
    }
  });

  it('rejects an unsupported extension degree', () => {
    expect(() => makeGF(9)).toThrow(/primitive polynomial/);
  });

  it('refuses to invert zero rather than returning a wrong element', () => {
    expect(() => gfInv(makeGF(4), 0)).toThrow(/undefined/);
  });
});
