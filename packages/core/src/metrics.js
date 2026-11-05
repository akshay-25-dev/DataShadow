// Leakage measurement. Given what was actually put on the wire, how much raw sensitive data is in it?
// Two independent checks: (1) value matching against the user's own sensitive profile values (catches
// renamed keys and values embedded in text), and (2) a PII tripwire that scans every string.
import { scanText } from './classifier.js';

const enc = new TextEncoder();
export const byteLength = (s) => enc.encode(String(s)).length;
export const payloadBytes = (obj) => byteLength(JSON.stringify(obj));

// Leaves carry the key they sit under, so values can be attributed to their own source field.
function leaves(v, key = null, out = []) {
  if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) leaves(x, k, out);
  } else if (v !== undefined) out.push({ key, v });
  return out;
}

// Policy-approved pass-through keys (low sensitivity). Their value is attributed to the field they come
// from, so a coincidental numeric match with some *other* sensitive field (e.g. loan amount == card
// limit) is not counted as a leak of that other field.
export const ATTRIBUTED_KEYS = new Set(['loan_amount', 'tenure_months', 'employment_type']);

export function measurePayload(body, profile, classifications, minSensitivity = 2, attributed = ATTRIBUTED_KEYS) {
  const sensitive = Object.entries(classifications).filter(
    ([k, c]) => c.sensitivity >= minSensitivity && profile[k] !== '' && profile[k] != null,
  );
  const totalSensitiveBytes = sensitive.reduce((n, [k]) => n + byteLength(profile[k]), 0);
  const all = leaves(body);
  const ls = all.filter((l) => !attributed.has(l.key)).map((l) => l.v);
  const exposedFields = [];
  let exposedBytes = 0;
  for (const [field] of sensitive) {
    const s = String(profile[field]).trim();
    if (s.length < 4) continue;
    const hit = ls.some((v) => (typeof v === 'string'
      ? v.toLowerCase().includes(s.toLowerCase())
      : typeof v === 'number' && String(v) === s));
    if (hit) { exposedFields.push(field); exposedBytes += byteLength(s); }
  }
  const tripwires = [];
  for (const { v } of all) if (typeof v === 'string') for (const f of scanText(v)) tripwires.push(f.label);
  return {
    totalBytes: payloadBytes(body),
    sensitiveFieldsTotal: sensitive.length,
    totalSensitiveBytes,
    exposedFields,
    exposedBytes,
    leakagePct: totalSensitiveBytes ? Math.round((1000 * exposedBytes) / totalSensitiveBytes) / 10 : 0,
    tripwires: [...new Set(tripwires)],
  };
}
