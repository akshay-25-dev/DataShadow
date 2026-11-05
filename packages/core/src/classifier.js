// Sensitive-field classifier. Combines two independent signals:
//   1. the field NAME (e.g. "monthlyIncome")  2. the field VALUE (e.g. matches PAN / valid Aadhaar checksum)
// and a text scanner for PII embedded in free text. All rule-based, deterministic and explainable,
// so the planner and policy engine can cite exactly why something was classified.
import { verhoeffValid } from './verhoeff.js';

export const CATEGORY = Object.freeze({
  DIRECT_ID: 'direct_identifier',
  QUASI_ID: 'quasi_identifier',
  FINANCIAL: 'financial',
  FREE_TEXT: 'free_text_pii',
  SERVICE: 'service_attribute',
  NONE: 'non_sensitive',
});

// Sensitivity scale: 0 none, 1 low, 2 medium, 3 high, 4 critical.
const squash = (v) => String(v).replace(/[\s-]/g, '');
const snake = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function dobLike(v) {
  const s = v.trim();
  let y;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) y = +m[1];
  else if ((m = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s))) y = +m[3];
  if (y == null) return 0;
  return y >= 1900 && y <= new Date().getFullYear() ? 0.75 : 0;
}

const DETECTORS = [
  {
    id: 'aadhaar', label: 'Aadhaar number', category: CATEGORY.DIRECT_ID, sensitivity: 4,
    name: /aadha?a?r|uidai/,
    value: (v) => {
      const s = squash(v);
      if (!/^[2-9]\d{11}$/.test(s)) return 0;
      return verhoeffValid(s) ? 0.98 : 0.6;
    },
    text: /(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
  },
  {
    id: 'pan', label: 'PAN', category: CATEGORY.DIRECT_ID, sensitivity: 3,
    name: /(^|_)pan($|_)/,
    value: (v) => (/^[A-Z]{5}\d{4}[A-Z]$/i.test(v.trim()) ? 0.97 : 0),
    text: /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g,
  },
  {
    id: 'phone', label: 'Phone number', category: CATEGORY.DIRECT_ID, sensitivity: 3,
    name: /phone|mobile|msisdn/,
    value: (v) => (/^(?:\+?91)?[6-9]\d{9}$/.test(squash(v)) ? 0.9 : 0),
    text: /(?<!\d)(?:\+?91[ -]?)?[6-9]\d{9}(?!\d)/g,
  },
  {
    id: 'email', label: 'Email address', category: CATEGORY.DIRECT_ID, sensitivity: 3,
    name: /e_?mail/,
    value: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 0.95 : 0),
    text: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    id: 'name', label: 'Person name', category: CATEGORY.DIRECT_ID, sensitivity: 3,
    name: /(^|_)name($|_)/,
  },
  {
    id: 'dob', label: 'Date of birth', category: CATEGORY.QUASI_ID, sensitivity: 2,
    name: /dob|birth/,
    value: dobLike,
    text: /\b(?:\d{4}-\d{2}-\d{2}|\d{2}[/-]\d{2}[/-]\d{4})\b/g,
  },
  {
    id: 'pincode', label: 'Postal PIN code', category: CATEGORY.QUASI_ID, sensitivity: 2,
    name: /pin_?code|postal|zip|(^|_)pin($|_)/,
    // A bare 6-digit number is far too ambiguous (loan amounts!) to count alone; it only adds weight to a name hint.
    value: (v) => (/^[1-9]\d{5}$/.test(v.trim()) ? 0.4 : 0),
  },
  {
    id: 'financial', label: 'Financial figure', category: CATEGORY.FINANCIAL, sensitivity: 3,
    name: /income|salary|emi|limit|outstanding|balance|credit|debt/,
  },
  {
    id: 'service', label: 'Service attribute', category: CATEGORY.SERVICE, sensitivity: 1,
    name: /employment|occupation|loan_amount|tenure/,
  },
];

const FREE_TEXT_NAME = /notes?|comment|remark|message|description/;

/** Find PII inside free text. Overlapping matches are resolved longest-first. */
export function scanText(text) {
  const raw = [];
  for (const d of DETECTORS) {
    if (!d.text) continue;
    const re = new RegExp(d.text.source, d.text.flags);
    for (const m of String(text).matchAll(re)) {
      raw.push({
        id: d.id, label: d.label, sensitivity: d.sensitivity,
        start: m.index, end: m.index + m[0].length, text: m[0],
      });
    }
  }
  raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  let last = -1;
  for (const r of raw) {
    if (r.start >= last) { out.push(r); last = r.end; }
  }
  return out;
}

export function classifyField(name, value) {
  const key = snake(name);
  const v = value == null ? '' : String(value);

  if (FREE_TEXT_NAME.test(key)) {
    const found = v ? scanText(v) : [];
    if (found.length) {
      return {
        field: name, category: CATEGORY.FREE_TEXT, primary: 'free_text_pii',
        sensitivity: Math.max(...found.map((f) => f.sensitivity)), confidence: 0.9,
        label: `Free text containing ${[...new Set(found.map((f) => f.label))].join(', ')}`,
        via: ['text-scan'],
        findings: found.map(({ id, label, sensitivity }) => ({ id, label, sensitivity })),
      };
    }
    return {
      field: name, category: CATEGORY.NONE, primary: null, sensitivity: 0, confidence: 0.8,
      label: 'Free text (no PII detected)', via: ['text-scan'],
    };
  }

  const byId = new Map();
  const add = (d, conf, via) => {
    const prev = byId.get(d.id);
    byId.set(d.id, {
      d, conf: prev ? 1 - (1 - prev.conf) * (1 - conf) : conf, via: [...(prev?.via ?? []), via],
    });
  };
  for (const d of DETECTORS) {
    if (d.name?.test(key)) add(d, 0.85, 'name');
    if (d.value && v) {
      const c = d.value(v);
      if (c > 0) add(d, c, 'value');
    }
  }
  const hits = [...byId.values()]
    .filter((h) => h.conf >= 0.5)
    .sort((a, b) => b.d.sensitivity - a.d.sensitivity || b.conf - a.conf);
  if (!hits.length) {
    return {
      field: name, category: CATEGORY.NONE, primary: null, sensitivity: 0, confidence: 0.5,
      label: 'Not sensitive', via: [],
    };
  }
  const top = hits[0];
  return {
    field: name, category: top.d.category, primary: top.d.id, sensitivity: top.d.sensitivity,
    confidence: +top.conf.toFixed(2), label: top.d.label, via: top.via,
  };
}

export function classifyProfile(profile) {
  const out = {};
  for (const [k, v] of Object.entries(profile)) out[k] = classifyField(k, v);
  return out;
}
