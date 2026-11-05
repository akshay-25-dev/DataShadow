// Domain: loan pre-eligibility. Everything below is SYNTHETIC sample data.
import { verhoeffCheckDigit } from './verhoeff.js';

const aadhaarBase = '23456789012';
export const SAMPLE_AADHAAR = aadhaarBase + verhoeffCheckDigit(aadhaarBase);

export const PROFILE_FIELDS = [
  { key: 'fullName', label: 'Full name', type: 'text', group: 'Identity' },
  { key: 'aadhaar', label: 'Aadhaar', type: 'text', group: 'Identity' },
  { key: 'pan', label: 'PAN', type: 'text', group: 'Identity' },
  { key: 'phone', label: 'Phone', type: 'text', group: 'Contact' },
  { key: 'email', label: 'Email', type: 'text', group: 'Contact' },
  { key: 'dob', label: 'Date of birth', type: 'date', group: 'Demographics' },
  { key: 'pincode', label: 'PIN code', type: 'text', group: 'Demographics' },
  { key: 'monthlyIncome', label: 'Monthly income (₹)', type: 'number', group: 'Finances' },
  { key: 'monthlyEmi', label: 'Existing EMIs / month (₹)', type: 'number', group: 'Finances' },
  { key: 'creditCardLimit', label: 'Credit card limit (₹)', type: 'number', group: 'Finances' },
  { key: 'creditCardOutstanding', label: 'Card outstanding (₹)', type: 'number', group: 'Finances' },
  { key: 'employmentType', label: 'Employment', type: 'select', options: ['salaried', 'self_employed', 'other'], group: 'Request' },
  { key: 'loanAmount', label: 'Loan amount (₹)', type: 'number', group: 'Request' },
  { key: 'tenureMonths', label: 'Tenure (months)', type: 'number', group: 'Request' },
  { key: 'notes', label: 'Notes for underwriter', type: 'textarea', group: 'Request' },
];

export const NUMERIC_FIELDS = PROFILE_FIELDS.filter((f) => f.type === 'number').map((f) => f.key);

export const SAMPLE_PROFILE = Object.freeze({
  fullName: 'Aarav Mehta',
  aadhaar: SAMPLE_AADHAAR,
  pan: 'ABCDE1234F',
  phone: '9876543210',
  email: 'aarav.mehta@example.com',
  dob: '1994-03-15',
  pincode: '560034',
  monthlyIncome: 85000,
  monthlyEmi: 12000,
  creditCardLimit: 200000,
  creditCardOutstanding: 40000,
  employmentType: 'salaried',
  loanAmount: 500000,
  tenureMonths: 36,
  notes: 'Please call me on 9876543210 after 6pm. My PAN is ABCDE1234F.',
});

export function normalizeProfile(p) {
  const out = { ...p };
  for (const k of NUMERIC_FIELDS) out[k] = Number(p[k]);
  return out;
}

export function profileErrors(p) {
  const n = normalizeProfile(p);
  const errs = [];
  if (!(n.monthlyIncome > 0)) errs.push('Monthly income must be positive');
  if (!(n.loanAmount > 0)) errs.push('Loan amount must be positive');
  if (!(n.tenureMonths >= 6)) errs.push('Tenure must be at least 6 months');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.dob ?? ''))) errs.push('Date of birth is required');
  if (!/^[1-9]\d{5}$/.test(String(p.pincode ?? '').trim())) errs.push('PIN code must be 6 digits');
  for (const k of ['monthlyEmi', 'creditCardLimit', 'creditCardOutstanding']) {
    if (!(n[k] >= 0)) errs.push(`${k} must be 0 or more`);
  }
  return errs;
}
