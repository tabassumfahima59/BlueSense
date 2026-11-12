/** Set one share and rescale the others proportionally so the total stays exactly 100. */
export function rebalance(shares: Record<string, number>, key: string, value: number): Record<string, number> {
  const v = Math.max(0, Math.min(100, value));
  const others = Object.keys(shares).filter((k) => k !== key);
  const rest = others.reduce((s, k) => s + shares[k], 0);
  const out: Record<string, number> = { ...shares, [key]: v };
  const remaining = 100 - v;
  others.forEach((k) => {
    out[k] = rest > 0 ? (shares[k] / rest) * remaining : remaining / others.length;
  });
  // round to 0.1 and push any rounding residue onto the largest other share
  others.forEach((k) => (out[k] = Math.round(out[k] * 10) / 10));
  out[key] = Math.round(v * 10) / 10;
  const total = Object.values(out).reduce((s, x) => s + x, 0);
  const residue = Math.round((100 - total) * 10) / 10;
  if (residue !== 0 && others.length) {
    const big = others.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[big] = Math.round((out[big] + residue) * 10) / 10;
  }
  return out;
}
