// Execution planner: for each computation decide LOCAL vs REMOTE (and in what form) automatically.
//
// 1. Hard constraints come from the policy engine: an option is infeasible if it would need an input
//    in a form the policy forbids (raw financial data, an identifier without consent, ...), or if the
//    device is offline, or the computation simply doesn't exist on that side.
// 2. Among feasible options, minimise  privacy*risk + latency*min(1, ms/cap) + authority*(provisional).
// Every decision carries human-readable reasons plus the alternatives it rejected, for the inspector UI.
import { COMPUTATIONS } from './computations.js';
import { evaluateField } from './policy.js';

const TRANSFORM_RISK = { none: 1, bucket: 0.3, generalize_prefix: 0.4, redact: 0.1 };
const PRODUCES_OUTPUT = new Set([
  'LOCAL', 'LOCAL_FALLBACK', 'PASSTHROUGH', 'REMOTE', 'REMOTE_TRANSFORMED', 'REMOTE_CONSENTED', 'DEFERRED',
]);

export function makeContext({
  classifications, policy, network = { online: true, rttMs: 60 }, consent = {}, device = { slowdown: 1 },
}) {
  return {
    classifications, policy, network, consent, device,
    derivedKeys: new Set(COMPUTATIONS.map((c) => c.outputKey).filter(Boolean)),
    available: new Set(),
  };
}

function describeInput(name, ctx) {
  if (ctx.derivedKeys.has(name)) {
    return {
      name, derived: true, sensitivity: 1, category: 'derived',
      action: { action: 'allow_raw', ruleId: 'derived', allowedTransforms: [] },
    };
  }
  const cls = ctx.classifications[name] ?? { sensitivity: 0, category: 'non_sensitive', primary: null };
  return {
    name, derived: false, sensitivity: cls.sensitivity, category: cls.category, label: cls.label,
    action: evaluateField(ctx.policy, cls),
  };
}

function evalRemote(comp, inputs, ctx) {
  const { weights: w, latencyCapMs: cap } = ctx.policy.planner;
  const blockedBy = [];
  const transforms = {};
  const rawFields = [];
  let risk = 0;
  let consented = false;
  if (!comp.remoteCapable) blockedBy.push({ code: 'NOT_REMOTE', text: 'has no server implementation' });
  for (const i of inputs) {
    const a = i.action;
    if (i.derived) {
      transforms[i.name] = 'none';
      risk = Math.max(risk, (0.1 * i.sensitivity) / 4);
    } else if (a.action === 'allow_raw') {
      transforms[i.name] = 'none';
      rawFields.push(i.name);
      risk = Math.max(risk, i.sensitivity / 4);
    } else if (a.action === 'transform_only') {
      const t = comp.remoteTransforms?.[i.name];
      if (t && a.allowedTransforms.includes(t)) {
        transforms[i.name] = t;
        risk = Math.max(risk, (i.sensitivity / 4) * TRANSFORM_RISK[t]);
      } else {
        blockedBy.push({
          code: 'POLICY', rule: a.ruleId,
          text: `${i.name} may only leave the device as [${a.allowedTransforms.join(', ')}] (${a.ruleId}); doing this remotely needs the raw value`,
        });
      }
    } else if (a.action === 'consent_required') {
      if (comp.consentKey && ctx.consent?.[comp.consentKey]) {
        transforms[i.name] = 'none';
        rawFields.push(i.name);
        consented = true;
        risk = Math.max(risk, i.sensitivity / 4);
      } else {
        blockedBy.push({
          code: 'CONSENT', rule: a.ruleId,
          text: `${i.name} requires explicit consent for ${a.purpose} (${a.ruleId})`,
        });
      }
    } else {
      blockedBy.push({ code: 'POLICY', rule: a.ruleId, text: `${i.name} is never transmitted (${a.ruleId})` });
    }
  }
  if (!ctx.network.online) blockedBy.push({ code: 'OFFLINE', text: 'device is offline' });
  const latencyMs = (ctx.network.online ? ctx.network.rttMs : Infinity) + comp.costMs.remote;
  const feasible = blockedBy.length === 0;
  const score = feasible ? w.privacy * risk + w.latency * Math.min(1, latencyMs / cap) : Infinity;
  return { executor: 'remote', feasible, blockedBy, transforms, rawFields, consented, risk, latencyMs, score };
}

function evalLocal(comp, ctx) {
  const { weights: w, latencyCapMs: cap } = ctx.policy.planner;
  const capable = !!(comp.localCapable || comp.localFallback);
  const latencyMs = comp.costMs.local * ctx.device.slowdown;
  const authority = comp.localCapable ? 0 : 1;
  return {
    executor: 'local', feasible: capable,
    blockedBy: capable ? [] : [{ code: 'NOT_LOCAL', text: 'needs server-side data or models' }],
    latencyMs, risk: 0, provisional: !comp.localCapable && capable,
    score: capable ? w.latency * Math.min(1, latencyMs / cap) + w.authority * authority : Infinity,
  };
}

const fmt = (o) => ({
  executor: o.executor, feasible: o.feasible, score: Number.isFinite(o.score) ? +o.score.toFixed(3) : null,
  latencyMs: Number.isFinite(o.latencyMs) ? Math.round(o.latencyMs) : null,
  risk: +o.risk.toFixed(3), blockedBy: o.blockedBy.map((b) => b.text),
});

export function planComputation(comp, ctx) {
  const inputs = comp.inputs.map((n) => describeInput(n, ctx));
  const base = {
    id: comp.id, label: comp.label, kind: comp.kind, outputKey: comp.outputKey ?? null,
    serverOp: comp.serverOp ?? null,
    inputs: inputs.map((i) => ({ name: i.name, derived: i.derived, sensitivity: i.sensitivity, rule: i.action.ruleId })),
    transforms: {}, rawFields: [], reasons: [], options: {},
  };

  if (comp.kind === 'passthrough') {
    const a = inputs[0].action;
    const ok = a.action === 'allow_raw';
    return {
      ...base, executor: ok ? 'local' : 'none', decision: ok ? 'PASSTHROUGH' : 'WITHHELD',
      rawFields: ok ? [comp.inputs[0]] : [],
      reasons: [ok
        ? `Low-sensitivity service attribute; ${a.ruleId} allows it to be sent as-is (data minimisation: only fields the lender needs).`
        : `Not sent: ${a.why}`],
    };
  }

  const missing = comp.inputs.filter((n) => ctx.derivedKeys.has(n) && !ctx.available.has(n));
  if (missing.length) {
    return {
      ...base, executor: 'none', decision: 'BLOCKED_UPSTREAM',
      reasons: [`Needs ${missing.join(', ')}, which could not be produced.`],
    };
  }

  const remote = evalRemote(comp, inputs, ctx);
  const local = evalLocal(comp, ctx);
  base.options = { local: fmt(local), remote: fmt(remote) };
  const rejectedRemote = remote.blockedBy.filter((b) => b.code !== 'NOT_REMOTE').map((b) => b.text);

  const feasible = [local, remote].filter((o) => o.feasible)
    .sort((a, b) => a.score - b.score || (a.executor === 'local' ? -1 : 1));

  if (!feasible.length) {
    const hard = remote.blockedBy.filter((b) => b.code !== 'OFFLINE');
    if (hard.some((b) => b.code === 'CONSENT')) {
      return {
        ...base, executor: 'none', decision: 'BLOCKED_CONSENT',
        reasons: [...rejectedRemote, 'Not executed: no consent was given. Nothing sensitive left the device.'],
      };
    }
    if (hard.length === 0 && comp.deferrable) {
      return {
        ...base, executor: 'remote', decision: 'DEFERRED', transforms: remote.transforms, rawFields: remote.rawFields,
        reasons: ['Device is offline and this needs server-side data. Queued; it will sync when connectivity returns.'],
      };
    }
    return {
      ...base, executor: 'none', decision: 'BLOCKED',
      reasons: [...rejectedRemote, ...(comp.noQueueNote ? [`Not queued: ${comp.noQueueNote}.`] : [])],
    };
  }

  const win = feasible[0];
  if (win.executor === 'local') {
    const reasons = [];
    if (rejectedRemote.length) reasons.push(`Remote rejected: ${rejectedRemote.join('; ')}.`);
    if (win.provisional) {
      reasons.push(
        `Provisional on-device result: waiting on the server (~${Math.round(remote.latencyMs)} ms) scores worse than answering now. It will be confirmed when synced.`,
      );
    } else if (comp.outputKey) {
      reasons.push(`Computed on-device (~${Math.round(win.latencyMs)} ms). Only the resulting ${comp.outputKey} can leave the device.`);
    } else {
      reasons.push(`Computed on-device (~${Math.round(win.latencyMs)} ms).`);
    }
    return {
      ...base, executor: 'local', decision: win.provisional ? 'LOCAL_FALLBACK' : 'LOCAL', reasons,
    };
  }

  const reasons = [];
  let decision = 'REMOTE';
  const nonRaw = Object.entries(remote.transforms).filter(([, t]) => t !== 'none');
  if (remote.consented) {
    decision = 'REMOTE_CONSENTED';
    reasons.push(`${remote.rawFields.join(', ')} sent raw under explicit consent (${comp.consentKey}); recorded in the audit ledger.`);
  } else if (nonRaw.length) {
    decision = 'REMOTE_TRANSFORMED';
    reasons.push(`Needs server-side data. Inputs sent only as: ${nonRaw.map(([f, t]) => `${f} → ${t}`).join(', ')}.`);
  } else {
    reasons.push('Inputs are already-derived bands, so the server can run the model without seeing any raw data.');
  }
  reasons.push(`Estimated round trip ~${Math.round(remote.latencyMs)} ms.`);
  return {
    ...base, executor: 'remote', decision, transforms: remote.transforms, rawFields: remote.rawFields, reasons,
  };
}

export function planAll(ctxIn) {
  const available = new Set();
  const ctx = { ...ctxIn, available };
  const plan = [];
  for (const comp of COMPUTATIONS) {
    const e = planComputation(comp, ctx);
    plan.push(e);
    if (e.outputKey && PRODUCES_OUTPUT.has(e.decision)) available.add(e.outputKey);
  }
  return plan;
}
