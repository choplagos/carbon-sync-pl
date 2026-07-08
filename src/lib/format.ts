export function fmtKg(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(2)} kt`;
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(1)} t`;
  return `${kg.toFixed(0)} kg`;
}

export function fmtNum(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
