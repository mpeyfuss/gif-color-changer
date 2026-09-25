// Helpers that reproduce numpy's numeric behavior, so output matches the
// original Python implementation byte-for-byte.

export const f32 = Math.fround;

/** Round to the nearest integer, ties to even, like `np.rint`. */
export function rint(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
