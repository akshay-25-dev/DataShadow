// Glue: executes the local part of a plan, builds the minimal payload, and reconstructs the final
// result on-device by merging the server's answer with exact values that never left the browser.
import { COMPUTATIONS_BY_ID } from './computations.js';
import { FEATURES, LOAN_ANNUAL_RATE, scoreDerived } from './model.js';
import { bucketLabel, clamp, redactText, applyTransform, emi } from './transforms.js';
import { randomizedResponse } from './privacy.js';
import { normalizeProfile } from './schema.js';

const SERVER_BOUND = new Set(['REMOTE', 'REMOTE_TRANSFORMED', 'REMOTE_CONSENTED', 'DEFERRED', 'LOCAL_FALLBACK']);

/**
 * Runs every plan entry assigned to the device. Pure apart from the budget it mutates, so it can run
 * inside a Web Worker. `epsilon = Infinity` means banding only (no noise).
 */
export function executeLocal(profile, plan, { budget, epsilon = Infinity, rng, now = new Date() }) {
  const released = {};
  const exact = {};
  const withheld = [];
  const timings = {};
  let epsilonSpent = 0;
  for (const e of plan) {
    if (e.executor !== 'local') continue;
    const comp = COMPUTATIONS_BY_ID[e.id];
    const t0 = performance.now();
    if (comp.kind === 'passthrough') {
      released[comp.outputKey] = comp.cast(profile[comp.inputs[0]]);
    } else if (comp.kind === 'redact') {
      const r = redactText(profile.notes ?? '');
      if (r) released.notes_redacted = r;
    } else if (comp.kind === 'feature') {
      const x = comp.exact(profile, now);
      exact[comp.outputKey] = x;
      const spec = FEATURES[comp.feature];
      const trueLabel = bucketLabel(clamp(x, spec.clip[0], spec.clip[1]), spec.edges, spec.labels);
      let label = trueLabel;
      if (Number.isFinite(epsilon)) {
        const memoKey = `${comp.feature}:${trueLabel}:${epsilon}`;
        if (budget.memo[memoKey] !== undefined) {
          label = budget.memo[memoKey];
        } else if (!budget.canSpend(epsilon)) {
          withheld.push({
            id: e.id, reason: `privacy budget exhausted (need ε=${epsilon}, ${budget.remaining.toFixed(1)} left)`,
          });
          continue;
        } else {
          budget.spend(epsilon, comp.outputKey);
          label = randomizedResponse(spec.labels, trueLabel, epsilon, rng);
          budget.memo[memoKey] = label;
          epsilonSpent += epsilon;
        }
      }
      released[comp.outputKey] = label;
    }
    timings[e.id] = +(performance.now() - t0).toFixed(3);
  }
  let provisional = null;
  if (plan.some((e) => e.id === 'risk_score' && e.decision === 'LOCAL_FALLBACK')) {
    try { provisional = scoreDerived(released); } catch { provisional = null; }
  }
  return { released, exact, withheld, timings, epsilonSpent, provisional, budget: budget.snapshot() };
}

/** Budget exhaustion discovered at execution time downgrades the affected entries. */
export function applyWithheld(plan, withheld) {
  if (!withheld.length) return plan;
  const reasons = new Map(withheld.map((w) => [w.id, w.reason]));
  const lost = new Set();
  const first = plan.map((e) => {
    if (!reasons.has(e.id)) return e;
    lost.add(e.outputKey);
    return { ...e, executor: 'none', decision: 'BLOCKED_BUDGET', reasons: [`Withheld: ${reasons.get(e.id)}.`] };
  });
  return first.map((e) => {
    if (e.decision !== 'BLOCKED_BUDGET' && e.inputs.some((i) => i.derived && lost.has(i.name))) {
      return {
        ...e, executor: 'none', decision: 'BLOCKED_UPSTREAM',
        reasons: [`Needs ${[...lost].join(', ')}, withheld by the privacy budget.`],
      };
    }
    return e;
  });
}

export function buildPayload(profile, plan, released, { consent = {}, session }) {
  const features = { ...released };
  const ops = [];
  for (const e of plan) {
    if (!SERVER_BOUND.has(e.decision)) continue;
    const comp = COMPUTATIONS_BY_ID[e.id];
    if (!comp.serverOp) continue;
    ops.push(comp.serverOp);
    for (const [field, t] of Object.entries(e.transforms)) {
      const key = comp.payloadKey?.[field];
      if (key) features[key] = applyTransform(t, profile[field]);
    }
  }
  return { v: 1, session, mode: 'datashadow', consent: { bureau: !!consent.bureau }, ops, features };
}

/** What happens to each raw field the user typed: stays local, leaves transformed, or leaves raw. */
export function fieldFates(profile, plan, mode = 'datashadow') {
  const rank = { LOCAL_ONLY: 0, TRANSFORMED: 1, SENT_RAW: 2 };
  const fates = {};
  for (const k of Object.keys(profile)) fates[k] = mode === 'traditional' ? 'SENT_RAW' : 'LOCAL_ONLY';
  if (mode === 'traditional') return fates;
  for (const e of plan) {
    if (!(e.decision === 'PASSTHROUGH' || SERVER_BOUND.has(e.decision) || e.decision === 'LOCAL')) continue;
    for (const i of e.inputs) {
      if (i.derived || !(i.name in fates)) continue;
      const next = e.rawFields.includes(i.name) ? 'SENT_RAW' : 'TRANSFORMED';
      if (rank[next] > rank[fates[i.name]]) fates[i.name] = next;
    }
  }
  return fates;
}

export function reconstruct(result, profile, exact) {
  const p = normalizeProfile(profile);
  const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
  return {
    decision: result.decision,
    score: result.score,
    reasonCodes: result.reasonCodes ?? [],
    parts: result.parts ?? null,
    serviceable: result.serviceable ?? null,
    bureau: result.bureau ?? null,
    // Exact figures computed on-device from raw data; the server only ever saw bands.
    localDetail: {
      dtiPct: pct(exact.dti_band),
      utilPct: pct(exact.util_band),
      affordPct: pct(exact.afford_band),
      proposedEmi: Math.round(emi(p.loanAmount, LOAN_ANNUAL_RATE, p.tenureMonths)),
      ageYears: exact.age_band ?? null,
    },
  };
}
