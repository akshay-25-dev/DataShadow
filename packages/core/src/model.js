// The lender's pre-eligibility model, in two forms that share one set of curves:
//   scoreRaw(exact features)      -> what a traditional app would compute from raw data
//   scoreDerived(released bands)  -> what DataShadow's server computes from bands only
// Band representative values (`mids`) are fed through the same curves, so the only difference
// between the two is information lost by banding (and noise, in Strict mode).
import { clamp, pwl } from './transforms.js';

export const BASE_SCORE = 600;
export const LOAN_ANNUAL_RATE = 0.11;

export const FEATURES = {
  dti: {
    key: 'dti_band', edges: [0.2, 0.35, 0.5], labels: ['lt20', '20_35', '35_50', 'gt50'],
    mids: [0.1, 0.275, 0.425, 0.65], clip: [0, 1],
    curve: [[0, 80], [0.15, 75], [0.35, 25], [0.5, -30], [0.7, -90]],
  },
  util: {
    key: 'util_band', edges: [0.3, 0.6, 0.8], labels: ['lt30', '30_60', '60_80', 'gt80'],
    mids: [0.15, 0.45, 0.7, 0.9], clip: [0, 1],
    curve: [[0, 50], [0.3, 40], [0.6, 0], [0.8, -40], [1, -70]],
  },
  afford: {
    key: 'afford_band', edges: [0.1, 0.25, 0.4], labels: ['lt10', '10_25', '25_40', 'gt40'],
    mids: [0.05, 0.175, 0.325, 0.5], clip: [0, 1],
    curve: [[0, 40], [0.1, 30], [0.25, 0], [0.4, -50], [0.6, -100]],
  },
  age: {
    key: 'age_band', edges: [25, 35, 50, 60], labels: ['18_24', '25_34', '35_49', '50_59', '60p'],
    mids: [21, 30, 42, 55, 65], clip: [18, 80],
    curve: [[18, -20], [25, 0], [35, 20], [50, 15], [60, -10], [70, -60]],
  },
  income: {
    key: 'income_band', edges: [25000, 50000, 100000, 200000],
    labels: ['lt25k', '25k_50k', '50k_100k', '100k_200k', 'gt200k'],
    mids: [17500, 37500, 75000, 150000, 250000], clip: [0, 1e7],
    curve: [[10000, -40], [25000, 0], [50000, 25], [100000, 45], [200000, 55]],
  },
};

export const EMPLOYMENT_TYPES = ['salaried', 'self_employed', 'other'];
const EMPLOYMENT_POINTS = { salaried: 20, self_employed: 5, other: -20 };
const BUREAU_POINTS = { good: 60, fair: 0, poor: -80 };
export const BUREAU_BANDS = Object.keys(BUREAU_POINTS);

const REASONS = {
  dti: 'DTI_HIGH', util: 'UTILIZATION_HIGH', afford: 'AFFORDABILITY_LOW', age: 'AGE_BAND_RISK',
  income: 'INCOME_LOW', employment: 'EMPLOYMENT_RISK', bureau: 'BUREAU_POOR',
};

export function decisionFor(score) {
  if (score >= 700) return 'LIKELY_APPROVE';
  if (score >= 600) return 'MANUAL_REVIEW';
  return 'LIKELY_DECLINE';
}

function finish(parts) {
  const total = BASE_SCORE + Object.values(parts).reduce((a, b) => a + b, 0);
  const score = Math.round(clamp(total, 300, 900));
  const reasonCodes = Object.entries(parts)
    .filter(([, pts]) => pts <= -20)
    .map(([k]) => REASONS[k]);
  const parts_ = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v)]));
  return { score, decision: decisionFor(score), reasonCodes, parts: parts_ };
}

/** Traditional scoring on exact feature values. */
export function scoreRaw(f) {
  const parts = {};
  for (const [name, spec] of Object.entries(FEATURES)) {
    parts[name] = pwl(spec.curve, clamp(f[name], spec.clip[0], spec.clip[1]));
  }
  parts.employment = EMPLOYMENT_POINTS[f.employment] ?? EMPLOYMENT_POINTS.other;
  if (f.bureau) parts.bureau = BUREAU_POINTS[f.bureau] ?? 0;
  return finish(parts);
}

/** DataShadow scoring on released bands only. Throws on any unknown band label. */
export function scoreDerived(d) {
  const parts = {};
  for (const [name, spec] of Object.entries(FEATURES)) {
    const idx = spec.labels.indexOf(d[spec.key]);
    if (idx < 0) throw new Error(`Missing or invalid ${spec.key}`);
    parts[name] = pwl(spec.curve, spec.mids[idx]);
  }
  parts.employment = EMPLOYMENT_POINTS[d.employment_type] ?? EMPLOYMENT_POINTS.other;
  if (d.bureau_band) parts.bureau = BUREAU_POINTS[d.bureau_band] ?? 0;
  return finish(parts);
}
