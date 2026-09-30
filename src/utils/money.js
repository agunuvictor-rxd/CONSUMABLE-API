export function round2(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`round2 expected a finite number, received: ${String(value)}`);
  }
  return Number(value.toFixed(2));
}
