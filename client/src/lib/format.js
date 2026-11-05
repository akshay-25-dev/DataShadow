// Presentation helpers: friendly band names and "what does the server see for this field?".
import { FEATURES, COMPUTATIONS_BY_ID } from '@datashadow/core';

const BY_KEY = Object.fromEntries(Object.values(FEATURES).map((s) => [s.key, s]));

export const KEY_NAMES = {
  dti_band: 'EMI share of income',
  util_band: 'Card usage',
  afford_band: 'New EMI share',
  age_band: 'Age',
  income_band: 'Income',
  notes_redacted: 'Notes',
  employment_type: 'Employment',
  loan_amount: 'Loan amount',
  tenure_months: 'Tenure',
  region3: 'Area code',
  pan: 'PAN',
};

const rupees = (n) => (n >= 100000 ? `₹${+(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${n / 1000}k` : `₹${n}`);

/** 'lt20' -> "under 20%", '50k_100k' -> "₹50k–₹1L" */
export function prettyBand(key, label) {
  const spec = BY_KEY[key];
  if (!spec) return String(label);
  const i = spec.labels.indexOf(label);
  if (i < 0) return String(label);
  const lo = i === 0 ? null : spec.edges[i - 1];
  const hi = spec.edges[i] ?? null;
  const pct = ['dti_band', 'util_band', 'afford_band'].includes(key);
  const f = (x) => (pct ? `${Math.round(x * 100)}%` : key === 'age_band' ? `${x}` : rupees(x));
  if (lo == null) return `under ${f(hi)}`;
  if (hi == null) return `${f(lo)}+`;
  return key === 'age_band' ? `${f(lo)}–${hi - 1}` : `${f(lo)}–${f(hi)}`;
}

export function prettyValue(key, value) {
  if (value === undefined || value === null) return null;
  if (BY_KEY[key]) return prettyBand(key, value);
  if (key === 'loan_amount') return `₹${Number(value).toLocaleString('en-IN')}`;
  if (key === 'tenure_months') return `${value} months`;
  if (key === 'employment_type') return String(value).replace('_', ' ');
  if (key === 'region3') return `${value}xxx`;
  if (key === 'notes_redacted') return String(value).length > 34 ? `${String(value).slice(0, 34)}…` : String(value);
  return String(value);
}

const SENT = new Set(['LOCAL', 'PASSTHROUGH', 'REMOTE', 'REMOTE_TRANSFORMED', 'REMOTE_CONSENTED', 'DEFERRED', 'LOCAL_FALLBACK']);

/**
 * What the server will see (or saw) for one profile field.
 * features: the payload.features of a fresh run, or null when the form changed since the last run.
 */
export function seesFor(field, { plan, features, cls, mode, profile }) {
  const sensitive = cls.sensitivity >= 2;
  if (mode === 'traditional') {
    return { kind: 'raw', sensitive, items: [{ key: field, text: String(profile[field] ?? ''), name: 'as typed' }] };
  }
  const items = [];
  let raw = false;
  for (const e of plan) {
    if (!SENT.has(e.decision)) continue;
    if (!e.inputs.some((i) => i.name === field && !i.derived)) continue;
    const comp = COMPUTATIONS_BY_ID[e.id];
    if (e.kind === 'feature' || e.kind === 'redact') {
      items.push({ key: e.outputKey, value: features?.[e.outputKey] });
    } else if (e.kind === 'passthrough') {
      raw = true;
      items.push({ key: e.outputKey, value: features?.[e.outputKey] ?? (e.outputKey === 'employment_type' ? profile[field] : Number(profile[field])) });
    } else if (e.kind === 'remote') {
      const pk = comp.payloadKey?.[field];
      if (!pk) continue;
      if (e.transforms[field] === 'none') raw = true;
      items.push({ key: pk, value: features?.[pk] });
    }
  }
  const seen = new Set();
  const uniq = items.filter((i) => (seen.has(i.key) ? false : seen.add(i.key)));
  return { kind: uniq.length ? (raw ? 'raw' : 'derived') : 'none', sensitive, items: uniq };
}
