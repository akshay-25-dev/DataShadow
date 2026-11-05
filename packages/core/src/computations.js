// Registry of computations the app needs. The planner decides, per computation, WHERE it runs.
import { FEATURES, LOAN_ANNUAL_RATE, EMPLOYMENT_TYPES } from './model.js';
import { ageYears, emi } from './transforms.js';
import { normalizeProfile } from './schema.js';

const ratio = (a, b) => (b > 0 ? a / b : 1);

// Exact (pre-banding) feature values. These never leave the device in DataShadow mode.
export function computeExactFeatures(rawProfile, now = new Date()) {
  const p = normalizeProfile(rawProfile);
  return {
    dti: ratio(p.monthlyEmi, p.monthlyIncome),
    util: p.creditCardLimit > 0 ? p.creditCardOutstanding / p.creditCardLimit : 0,
    afford: ratio(emi(p.loanAmount, LOAN_ANNUAL_RATE, p.tenureMonths), p.monthlyIncome),
    age: ageYears(p.dob, now),
    income: p.monthlyIncome,
    employment: p.employmentType,
  };
}

const feature = (id, label, feat, inputs, pick) => ({
  id, label, kind: 'feature', feature: feat, inputs, outputKey: FEATURES[feat].key,
  localCapable: true, remoteCapable: true, remoteTransforms: {}, costMs: { local: 2, remote: 20 },
  exact: (profile, now) => pick(computeExactFeatures(profile, now)),
});

const passthrough = (field, outputKey, cast) => ({
  id: outputKey, label: `Pass-through: ${field}`, kind: 'passthrough', inputs: [field], outputKey,
  localCapable: true, remoteCapable: false, costMs: { local: 0, remote: 0 }, cast,
});

export const COMPUTATIONS = [
  feature('dti_band', 'Debt-to-income band', 'dti', ['monthlyIncome', 'monthlyEmi'], (f) => f.dti),
  feature('util_band', 'Card utilization band', 'util', ['creditCardLimit', 'creditCardOutstanding'], (f) => f.util),
  feature('afford_band', 'New-EMI affordability band', 'afford', ['monthlyIncome', 'loanAmount', 'tenureMonths'], (f) => f.afford),
  feature('age_band', 'Age band', 'age', ['dob'], (f) => f.age),
  feature('income_band', 'Income band', 'income', ['monthlyIncome'], (f) => f.income),
  {
    id: 'notes_redact', label: 'Redact free-text notes', kind: 'redact', inputs: ['notes'], outputKey: 'notes_redacted',
    localCapable: true, remoteCapable: false, costMs: { local: 1, remote: 0 },
  },
  passthrough('employmentType', 'employment_type', (v) => (EMPLOYMENT_TYPES.includes(v) ? v : 'other')),
  passthrough('loanAmount', 'loan_amount', (v) => Math.round(Number(v))),
  passthrough('tenureMonths', 'tenure_months', (v) => Math.round(Number(v))),
  {
    id: 'region_check', label: 'Serviceable-region check', kind: 'remote', serverOp: 'region_check',
    inputs: ['pincode'], outputKey: null, deferrable: true,
    localCapable: false, remoteCapable: true,
    remoteTransforms: { pincode: 'generalize_prefix' }, payloadKey: { pincode: 'region3' },
    costMs: { local: 0, remote: 30 },
  },
  {
    id: 'bureau_lookup', label: 'Credit-bureau lookup (simulated)', kind: 'remote', serverOp: 'bureau_lookup',
    inputs: ['pan'], outputKey: null, deferrable: false, consentKey: 'bureau',
    noQueueNote: 'a raw identifier is never queued on the device',
    localCapable: false, remoteCapable: true,
    remoteTransforms: {}, payloadKey: { pan: 'pan' }, costMs: { local: 0, remote: 80 },
  },
  {
    id: 'risk_score', label: 'Eligibility score', kind: 'remote', serverOp: 'risk_score',
    inputs: ['dti_band', 'util_band', 'afford_band', 'age_band', 'income_band', 'employment_type'],
    outputKey: null,
    localCapable: false, localFallback: true, remoteCapable: true, remoteTransforms: {},
    costMs: { local: 40, remote: 120 },
  },
];

export const COMPUTATIONS_BY_ID = Object.fromEntries(COMPUTATIONS.map((c) => [c.id, c]));
