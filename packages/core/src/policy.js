// Declarative policy. First matching rule wins, so order = specificity.
// Actions: never_transmit | consent_required | transform_only | allow_raw
export const DEFAULT_POLICY = Object.freeze({
  version: '1.0',
  maxRawSensitivityToServer: 1,
  rules: [
    { id: 'R1-aadhaar-never', match: { primary: 'aadhaar' }, action: 'never_transmit',
      why: 'Aadhaar is critical-sensitivity; no loan pre-eligibility computation needs it.' },
    { id: 'R2-pan-consent', match: { primary: 'pan' }, action: 'consent_required', purpose: 'bureau_lookup',
      why: 'PAN is needed only for a credit-bureau lookup, and only with explicit consent.' },
    { id: 'R3-direct-ids-local', match: { category: 'direct_identifier' }, action: 'never_transmit',
      why: 'Direct identifiers (name, phone, email) never leave the device.' },
    { id: 'R4-dob-band', match: { primary: 'dob' }, action: 'transform_only', allowedTransforms: ['bucket'],
      why: 'Date of birth may leave only as an age band.' },
    { id: 'R5-pincode-prefix', match: { primary: 'pincode' }, action: 'transform_only',
      allowedTransforms: ['generalize_prefix'], why: 'PIN code may leave only as its 3-digit prefix.' },
    { id: 'R6-financial-band', match: { category: 'financial' }, action: 'transform_only',
      allowedTransforms: ['bucket'], why: 'Financial figures may leave only as coarse bands.' },
    { id: 'R7-freetext-redact', match: { category: 'free_text_pii' }, action: 'transform_only',
      allowedTransforms: ['redact'], why: 'Free text containing PII must be redacted before transmission.' },
  ],
  planner: {
    // score = privacy*risk + latency*min(1, ms/cap) + authority*(provisional ? 1 : 0); lower wins
    weights: { privacy: 0.65, latency: 0.35, authority: 0.25 },
    latencyCapMs: 2000,
  },
  privacy: {
    totalEpsilon: 40, // per-device budget (basic sequential composition)
    strictPerFeatureEpsilon: 2, // ε spent per released feature in "Strict" mode
  },
});

export function evaluateField(policy, cls) {
  for (const r of policy.rules) {
    const m = r.match;
    if ((m.primary && m.primary === cls.primary) || (m.category && m.category === cls.category)) {
      return {
        action: r.action, ruleId: r.id, allowedTransforms: r.allowedTransforms ?? [],
        purpose: r.purpose ?? null, why: r.why,
      };
    }
  }
  if (cls.sensitivity <= policy.maxRawSensitivityToServer) {
    return {
      action: 'allow_raw', ruleId: 'default-allow-low', allowedTransforms: [], purpose: null,
      why: `Sensitivity ${cls.sensitivity} is within the raw-transmission limit.`,
    };
  }
  return {
    action: 'never_transmit', ruleId: 'default-deny', allowedTransforms: [], purpose: null,
    why: 'No rule matched and sensitivity exceeds the raw-transmission limit (default deny).',
  };
}
