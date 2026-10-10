// Stop-order optimisation (travelling salesman with fixed start and end).
//
// The matrix is n x n where index `start` is the origin and `end` the destination
// (they may be equal for round trips). Every other index is a stop to visit exactly once.
// Matrices may be asymmetric (one-way streets make A->B differ from B->A).

export type Matrix = ArrayLike<ArrayLike<number | null>>;

const UNREACHABLE = 1e12;

function cell(m: Matrix, a: number, b: number): number {
  const v = m[a][b];
  return v == null || !Number.isFinite(v) ? UNREACHABLE : v;
}

export function pathCost(m: Matrix, path: number[]): number {
  let c = 0;
  for (let i = 0; i < path.length - 1; i++) c += cell(m, path[i], path[i + 1]);
  return c;
}

/** Exact Held–Karp DP. Feasible for up to ~13 intermediate nodes. */
function heldKarp(m: Matrix, start: number, end: number, nodes: number[]): number[] {
  const k = nodes.length;
  const full = 1 << k;
  const dp = new Float64Array(full * k).fill(Infinity);
  const parent = new Int16Array(full * k).fill(-1);
  for (let j = 0; j < k; j++) dp[(1 << j) * k + j] = cell(m, start, nodes[j]);
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < k; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * k + j];
      if (cur === Infinity) continue;
      for (let nx = 0; nx < k; nx++) {
        if (mask & (1 << nx)) continue;
        const nm = mask | (1 << nx);
        const v = cur + cell(m, nodes[j], nodes[nx]);
        if (v < dp[nm * k + nx]) {
          dp[nm * k + nx] = v;
          parent[nm * k + nx] = j;
        }
      }
    }
  }
  let best = Infinity;
  let last = -1;
  for (let j = 0; j < k; j++) {
    const v = dp[(full - 1) * k + j] + cell(m, nodes[j], end);
    if (v < best) {
      best = v;
      last = j;
    }
  }
  const order: number[] = [];
  let mask = full - 1;
  while (last !== -1) {
    order.push(nodes[last]);
    const p = parent[mask * k + last];
    mask &= ~(1 << last);
    last = p;
  }
  return order.reverse();
}

function nearestNeighbour(m: Matrix, start: number, nodes: number[]): number[] {
  const left = new Set(nodes);
  const out: number[] = [];
  let cur = start;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const n of left) {
      const d = cell(m, cur, n);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    out.push(best);
    left.delete(best);
    cur = best;
  }
  return out;
}

/** Cheapest-insertion construction — usually a better seed than nearest neighbour. */
function cheapestInsertion(m: Matrix, start: number, end: number, nodes: number[]): number[] {
  const path = [start, end];
  const left = new Set(nodes);
  while (left.size) {
    let bestNode = -1;
    let bestPos = -1;
    let bestDelta = Infinity;
    for (const n of left) {
      for (let i = 0; i < path.length - 1; i++) {
        const d = cell(m, path[i], n) + cell(m, n, path[i + 1]) - cell(m, path[i], path[i + 1]);
        if (d < bestDelta) {
          bestDelta = d;
          bestNode = n;
          bestPos = i + 1;
        }
      }
    }
    path.splice(bestPos, 0, bestNode);
    left.delete(bestNode);
  }
  return path.slice(1, -1);
}

/** 2-opt + Or-opt local search on a full path (endpoints fixed). Mutates and returns path. */
function localSearch(m: Matrix, path: number[]): number[] {
  const n = path.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;

    // 2-opt: reverse path[i..j]. Asymmetric-safe: recompute the reversed segment cost.
    for (let i = 1; i < n - 2; i++) {
      // forward cost of segment i..j accumulated incrementally
      let fwd = 0;
      let rev = 0;
      for (let j = i + 1; j < n - 1; j++) {
        fwd += cell(m, path[j - 1], path[j]);
        rev += cell(m, path[j], path[j - 1]);
        const before =
          cell(m, path[i - 1], path[i]) + fwd + cell(m, path[j], path[j + 1]);
        const after =
          cell(m, path[i - 1], path[j]) + rev + cell(m, path[i], path[j + 1]);
        if (after < before - 1e-9) {
          // reverse
          for (let a = i, b = j; a < b; a++, b--) {
            const t = path[a];
            path[a] = path[b];
            path[b] = t;
          }
          improved = true;
          fwd = 0;
          rev = 0;
          // recompute accumulators for the new arrangement up to j
          for (let q = i + 1; q <= j; q++) {
            fwd += cell(m, path[q - 1], path[q]);
            rev += cell(m, path[q], path[q - 1]);
          }
        }
      }
    }

    // Or-opt: move a segment of 1..3 nodes elsewhere (optionally reversed).
    for (let len = 1; len <= 3; len++) {
      for (let i = 1; i + len - 1 < n - 1; i++) {
        const segEnd = i + len - 1;
        const prev = path[i - 1];
        const next = path[segEnd + 1];
        const first = path[i];
        const last = path[segEnd];
        let segFwd = 0;
        let segRev = 0;
        for (let q = i; q < segEnd; q++) {
          segFwd += cell(m, path[q], path[q + 1]);
          segRev += cell(m, path[q + 1], path[q]);
        }
        const removeGain =
          cell(m, prev, first) + segFwd + cell(m, last, next) - cell(m, prev, next);
        let bestDelta = -1e-9;
        let bestJ = -1;
        let bestRev = false;
        for (let j = 0; j < n - 1; j++) {
          if (j >= i - 1 && j <= segEnd) continue; // insertion edge (j, j+1) must be outside the segment
          const a = path[j];
          const b = path[j + 1];
          const base = cell(m, a, b);
          const insF = cell(m, a, first) + segFwd + cell(m, last, b) - base;
          const insR = cell(m, a, last) + segRev + cell(m, first, b) - base;
          if (insF - removeGain < bestDelta) {
            bestDelta = insF - removeGain;
            bestJ = j;
            bestRev = false;
          }
          if (insR - removeGain < bestDelta) {
            bestDelta = insR - removeGain;
            bestJ = j;
            bestRev = true;
          }
        }
        if (bestJ !== -1) {
          const seg = path.splice(i, len);
          if (bestRev) seg.reverse();
          const insertAt = bestJ < i ? bestJ + 1 : bestJ + 1 - len;
          path.splice(insertAt, 0, ...seg);
          improved = true;
        }
      }
    }
  }
  return path;
}

/** Deterministic PRNG so results are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Double-bridge perturbation for iterated local search. */
function doubleBridge(path: number[], rand: () => number): number[] {
  const inner = path.slice(1, -1);
  const n = inner.length;
  if (n < 8) return path.slice();
  const cuts = [0, 0, 0].map(() => 1 + Math.floor(rand() * (n - 1))).sort((a, b) => a - b);
  const [a, b, c] = cuts;
  const next = [...inner.slice(0, a), ...inner.slice(b, c), ...inner.slice(a, b), ...inner.slice(c)];
  return [path[0], ...next, path[path.length - 1]];
}

export interface OptimizeOptions {
  /** wall-clock budget for iterated local search (ms) */
  timeBudgetMs?: number;
  seed?: number;
}

/**
 * Returns the visiting order of all indices other than start/end.
 * When start === end the route is a round trip.
 */
export function optimizeOrder(
  m: Matrix,
  start: number,
  end: number,
  opts: OptimizeOptions = {},
): number[] {
  const size = m.length;
  const nodes: number[] = [];
  for (let i = 0; i < size; i++) if (i !== start && i !== end) nodes.push(i);
  if (nodes.length <= 1) return nodes;
  if (nodes.length <= 12) return heldKarp(m, start, end, nodes);

  const budget = opts.timeBudgetMs ?? 400;
  const rand = mulberry32(opts.seed ?? 42);
  const deadline = Date.now() + budget;

  const seeds = [cheapestInsertion(m, start, end, nodes), nearestNeighbour(m, start, nodes)];
  let best: number[] = [];
  let bestCost = Infinity;
  for (const s of seeds) {
    const p = localSearch(m, [start, ...s, end]);
    const c = pathCost(m, p);
    if (c < bestCost) {
      bestCost = c;
      best = p;
    }
  }
  // iterated local search
  let iterations = 0;
  while (Date.now() < deadline && iterations++ < 2000) {
    const cand = localSearch(m, doubleBridge(best, rand));
    const c = pathCost(m, cand);
    if (c < bestCost - 1e-9) {
      bestCost = c;
      best = cand;
    }
  }
  return best.slice(1, -1);
}

/**
 * Best position to insert a new node into an existing visiting order (cheapest insertion).
 * `order` holds intermediate node indices; returns the index in `order` at which to insert.
 */
export function bestInsertionIndex(m: Matrix, start: number, end: number, order: number[], node: number): number {
  const path = [start, ...order, end];
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = cell(m, path[i], node) + cell(m, node, path[i + 1]) - cell(m, path[i], path[i + 1]);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}
