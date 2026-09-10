/**
 * Safe intervals: for each plan cell, the maximal runs of quanta during which
 * nobody can see it. A cell watched by a sweeping camera has a handful of these,
 * which is what lets the search reason about time without enumerating every
 * quarter-second.
 */
export interface SafeIntervals {
  /** planCount + 1 entries; intervals of cell c live in [offset[c], offset[c+1]). */
  offset: Int32Array;
  lo: Int32Array;
  hi: Int32Array;
  /** Owning plan cell of each interval, so the search never has to search back. */
  cell: Int32Array;
  count: number;
  horizonQ: number;
}

export function buildIntervals(
  danger: Uint8Array,
  pwalk: Uint8Array,
  planCount: number,
  horizonQ: number,
): SafeIntervals {
  const offset = new Int32Array(planCount + 1);
  const lo: number[] = [];
  const hi: number[] = [];
  const cell: number[] = [];
  for (let c = 0; c < planCount; c++) {
    offset[c] = lo.length;
    if (!pwalk[c]) continue;
    let start = -1;
    for (let q = 0; q < horizonQ; q++) {
      const blockedNow = danger[q * planCount + c] === 1;
      if (!blockedNow && start < 0) start = q;
      else if (blockedNow && start >= 0) {
        lo.push(start);
        hi.push(q - 1);
        cell.push(c);
        start = -1;
      }
    }
    if (start >= 0) {
      lo.push(start);
      hi.push(horizonQ - 1);
      cell.push(c);
    }
  }
  offset[planCount] = lo.length;
  return {
    offset,
    lo: Int32Array.from(lo),
    hi: Int32Array.from(hi),
    cell: Int32Array.from(cell),
    count: lo.length,
    horizonQ,
  };
}

/** Index of the interval of `cell` containing `q`, or -1. */
export function intervalAt(iv: SafeIntervals, cell: number, q: number): number {
  const a = iv.offset[cell];
  const b = iv.offset[cell + 1];
  for (let i = a; i < b; i++) {
    if (q >= iv.lo[i] && q <= iv.hi[i]) return i;
  }
  return -1;
}

/** First interval of `cell` that ends at or after `q`. */
export function intervalFrom(iv: SafeIntervals, cell: number, q: number): number {
  const a = iv.offset[cell];
  const b = iv.offset[cell + 1];
  for (let i = a; i < b; i++) {
    if (iv.hi[i] >= q) return i;
  }
  return -1;
}
