/**
 * Seeded RNG (mulberry32). Deterministic, tiny, pure — the only randomness the sim may use.
 *
 *   const rng = createRng(123);
 *   rng.next()          // [0,1)
 *   rng.range(a, b)     // [a,b)
 *   rng.int(a, b)       // integer in [a,b]
 *   rng.pick(array)
 *   rng.chance(p)       // boolean
 *   rng.fork(salt)      // independent child stream (stable for a given parent seed + salt)
 */
export function createRng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  const initial = s;

  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    get seed() { return initial; },
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    fork: (salt = 1) => createRng(hash32(initial, salt)),
  };
}

export function hash32(a, b = 0) {
  let h = (a ^ 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (b + 0x9e3779b9), 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** Seed from a string (e.g. URL param) or number. */
export function seedFrom(value) {
  if (value == null || value === '') return (Date.now() ^ 0x5bd1e995) >>> 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n >>> 0;
  let h = 2166136261;
  for (let i = 0; i < String(value).length; i++) h = Math.imul(h ^ String(value).charCodeAt(i), 16777619);
  return h >>> 0;
}
