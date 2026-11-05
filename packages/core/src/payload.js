// Server-side contract for what may arrive. This is an ALLOWLIST, not a blocklist: any field that is
// not named here is rejected, so a client bug (or a compromised client) can't leak extra data by accident.
// Error messages deliberately never echo values, since a rejected value might itself be PII.
import { FEATURES, EMPLOYMENT_TYPES } from './model.js';
import { scanText } from './classifier.js';

const band = (k) => ({ enum: FEATURES[k].labels });

export const PAYLOAD_SCHEMA = {
  dti_band: band('dti'),
  util_band: band('util'),
  afford_band: band('afford'),
  age_band: band('age'),
  income_band: band('income'),
  employment_type: { enum: EMPLOYMENT_TYPES },
  loan_amount: { int: [10000, 100000000] },
  tenure_months: { int: [6, 360] },
  region3: { regex: /^[1-9]\d{2}$/ },
  notes_redacted: { text: 500 },
  pan: { regex: /^[A-Z]{5}\d{4}[A-Z]$/, consent: 'bureau' },
};

export const SERVER_OPS = ['risk_score', 'region_check', 'bureau_lookup'];
const TOP_KEYS = ['v', 'session', 'mode', 'consent', 'ops', 'features'];

export function validatePayload(body) {
  const errors = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errors: ['body must be a JSON object'] };
  }
  for (const k of Object.keys(body)) {
    if (!TOP_KEYS.includes(k)) errors.push(`unexpected top-level field "${k}"`);
  }
  if (body.v !== 1) errors.push('unsupported payload version');
  if (typeof body.session !== 'string' || !/^[\w-]{8,64}$/.test(body.session)) errors.push('invalid session id');
  if (!Array.isArray(body.ops) || body.ops.some((o) => !SERVER_OPS.includes(o))) errors.push('invalid ops');
  const f = body.features;
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    errors.push('features must be an object');
    return { ok: false, errors };
  }
  for (const [k, v] of Object.entries(f)) {
    const spec = PAYLOAD_SCHEMA[k];
    if (!spec) { errors.push(`field "${k}" is not on the allowlist`); continue; }
    if (spec.consent && body.consent?.[spec.consent] !== true) errors.push(`"${k}" requires consent.${spec.consent}`);
    if (spec.enum && !spec.enum.includes(v)) errors.push(`"${k}" has an invalid value`);
    if (spec.int && !(Number.isInteger(v) && v >= spec.int[0] && v <= spec.int[1])) errors.push(`"${k}" is out of range`);
    if (spec.regex && !(typeof v === 'string' && spec.regex.test(v))) errors.push(`"${k}" has an invalid format`);
    if (spec.text) {
      if (typeof v !== 'string' || v.length > spec.text) errors.push(`"${k}" must be a string up to ${spec.text} chars`);
      else {
        const found = scanText(v);
        if (found.length) errors.push(`"${k}" still contains ${[...new Set(found.map((x) => x.label))].join(', ')}`);
      }
    }
  }
  if (Array.isArray(body.ops)) {
    if (body.ops.includes('risk_score')) {
      for (const spec of Object.values(FEATURES)) {
        if (!(spec.key in f)) errors.push(`risk_score requires "${spec.key}"`);
      }
      if (!('employment_type' in f)) errors.push('risk_score requires "employment_type"');
    }
    if (body.ops.includes('region_check') && !('region3' in f)) errors.push('region_check requires "region3"');
    if (body.ops.includes('bureau_lookup') && !('pan' in f)) errors.push('bureau_lookup requires "pan"');
  }
  return { ok: errors.length === 0, errors };
}
