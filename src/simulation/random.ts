export interface Rng {
  // Uniform in [0, 1).
  next: () => number;
  // Integer in [0, n).
  int: (n: number) => number;
  // Integer in [min, max], both inclusive.
  between: (min: number, max: number) => number;
  // Returns an index chosen proportionally to the (non-negative) weights.
  weighted: (weights: readonly number[]) => number;
}

// mulberry32: tiny, fast, and fully determined by a 32-bit seed.
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number) => Math.floor(next() * n);
  const between = (min: number, max: number) => min + int(max - min + 1);

  const weighted = (weights: readonly number[]) => {
    let total = 0;
    for (const w of weights) total += w;
    let roll = next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i] ?? 0;
      if (roll < 0) return i;
    }
    return weights.length - 1;
  };

  return { next, int, between, weighted };
}

// Stateless integer hash, used where a value must depend only on its inputs and not on call order.
export function mix32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}
