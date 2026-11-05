import { scanText } from './classifier.js';

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Index of the band x falls in. Edges are inclusive lower bounds of the next band. */
export function bucketIndex(x, edges) {
  let i = 0;
  while (i < edges.length && x >= edges[i]) i++;
  return i;
}
export const bucketLabel = (x, edges, labels) => labels[bucketIndex(x, edges)];

export function ageYears(dobIso, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dobIso).trim());
  if (!m) return NaN;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  let age = now.getUTCFullYear() - y;
  const month = now.getUTCMonth() + 1;
  if (month < mo || (month === mo && now.getUTCDate() < d)) age--;
  return age;
}

export const generalizePrefix = (s, n = 3) => String(s).trim().slice(0, n);

/** Piecewise-linear interpolation through [x, y] control points (clamped at the ends). */
export function pwl(curve, x) {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    const [x0, y0] = curve[i - 1];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return curve[curve.length - 1][1];
}

/** Standard amortised EMI. */
export function emi(principal, annualRate, months) {
  const r = annualRate / 12;
  if (!(months > 0)) return NaN;
  if (r === 0) return principal / months;
  const f = (1 + r) ** months;
  return (principal * r * f) / (f - 1);
}

/** Replace every detected PII span in free text with a typed placeholder. */
export function redactText(text) {
  const s = String(text ?? '');
  let out = '';
  let i = 0;
  for (const f of scanText(s)) {
    out += s.slice(i, f.start) + `[${f.id.toUpperCase()} REDACTED]`;
    i = f.end;
  }
  return out + s.slice(i);
}

export function applyTransform(transform, value) {
  switch (transform) {
    case 'none': return value;
    case 'generalize_prefix': return generalizePrefix(value, 3);
    case 'redact': return redactText(value);
    default: throw new Error(`Unknown transform: ${transform}`);
  }
}
