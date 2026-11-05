import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SAMPLE_PROFILE, DEFAULT_POLICY, classifyProfile, makeContext, planAll, measurePayload,
  profileErrors, applyWithheld, buildPayload, reconstruct, payloadBytes, generateProfile, secureRng,
  normalizeProfile, AuditLedger,
} from '@datashadow/core';
import * as rt from './lib/runtime.js';
import { Segmented, Toggle } from './components/Controls.jsx';
import Stepper from './components/Stepper.jsx';
import DataPanel from './components/DataPanel.jsx';
import Verdict from './components/Verdict.jsx';
import PlanPanel from './components/PlanPanel.jsx';
import ExplainPanel from './components/ExplainPanel.jsx';
import EvalPanel from './components/EvalPanel.jsx';
import RequestPanel from './components/RequestPanel.jsx';
import LedgerPanel from './components/LedgerPanel.jsx';

const SLOW_EXTRA_MS = 2500;
const PACE_MS = 240; // short pause between steps so the stepper is readable in a live demo
const STRICT_EPS = DEFAULT_POLICY.privacy.strictPerFeatureEpsilon;

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <rect x="1" y="1" width="28" height="28" rx="8" fill="#0F1A2B" />
      <rect x="7" y="7" width="12" height="16" rx="3" fill="#EEF1F5" />
      <rect x="11" y="11" width="12" height="12" rx="3" fill="#3B4FE0" opacity="0.95" />
    </svg>
  );
}

export default function App() {
  const [profile, setProfile] = useState({ ...SAMPLE_PROFILE });
  const [mode, setMode] = useState('datashadow');
  const [net, setNet] = useState('online');
  const [privacy, setPrivacy] = useState('standard');
  const [consent, setConsent] = useState({ bureau: false });
  const [rtt, setRtt] = useState(40);
  const [errors, setErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(-1);
  const [run, setRun] = useState(null);
  const [record, setRecord] = useState(null);
  const [budget, setBudget] = useState(() => rt.loadBudget());
  const [queue, setQueue] = useState(() => rt.loadQueue());
  const [status, setStatus] = useState('');

  const session = useMemo(() => rt.getSession(), []);
  const ledgerRef = useRef(null);
  if (!ledgerRef.current) ledgerRef.current = rt.loadLedger();
  const [entries, setEntries] = useState(() => [...ledgerRef.current.entries]);
  const [tampered, setTampered] = useState(false);
  const [chain, setChain] = useState(null);

  // ---- derived view state ------------------------------------------------------------------------
  const classifications = useMemo(() => classifyProfile(profile), [profile]);
  const network = useMemo(
    () => (net === 'offline'
      ? { online: false, rttMs: Infinity }
      : { online: true, rttMs: rtt + (net === 'slow' ? SLOW_EXTRA_MS : 0) }),
    [net, rtt],
  );
  const livePlan = useMemo(
    () => planAll(makeContext({ classifications, policy: DEFAULT_POLICY, network, consent })),
    [classifications, network, consent],
  );
  const stamp = JSON.stringify([profile, mode, net, privacy, consent]);
  const fresh = !!run && run.stamp === stamp;
  const plan = fresh && run.plan ? run.plan : livePlan;
  const features = fresh && run.payload ? run.payload.features : null;
  const tradMetrics = useMemo(
    () => measurePayload({ profile: normalizeProfile(profile) }, normalizeProfile(profile), classifications),
    [profile, classifications],
  );
  const profileFlags = useMemo(
    () => Object.entries(classifications).filter(([, c]) => c.sensitivity >= 2).map(([k]) => k),
    [classifications],
  );

  // ---- ledger helpers ----------------------------------------------------------------------------
  const log = useCallback(async (type, detail) => {
    await ledgerRef.current.append(type, detail);
    rt.saveLedger(ledgerRef.current);
    setEntries([...ledgerRef.current.entries]);
  }, []);

  useEffect(() => {
    let alive = true;
    const l = ledgerRef.current;
    let verifier = l;
    if (tampered && l.entries.length > 1) {
      const mid = Math.floor(l.entries.length / 2);
      verifier = new AuditLedger(l.entries.map((e, i) => (i === mid ? { ...e, detail: { ...e.detail, tampered: true } } : e)));
    }
    verifier.verify().then((r) => alive && setChain(r));
    return () => { alive = false; };
  }, [entries, tampered]);

  useEffect(() => { rt.probeRtt().then((ms) => ms != null && setRtt(Math.max(5, ms))); }, []);

  const refreshRecord = useCallback(async () => {
    const recs = await rt.fetchReceived(session);
    setRecord(recs[0] ?? null);
  }, [session]);
  useEffect(() => { refreshRecord(); }, [refreshRecord]);

  // ---- queue flush (offline -> online) -----------------------------------------------------------
  const flushQueue = useCallback(async () => {
    const q = rt.loadQueue();
    if (!q.length) return;
    setBusy(true);
    const remaining = [];
    for (const item of q) {
      const res = await rt.sendDataShadow(item.payload);
      if (!res.ok) { remaining.push(item); continue; }
      await log('SYNC', {
        queued: item.id, ops: item.payload.ops, bytes: payloadBytes(item.payload),
        provisionalDecision: item.provisional?.decision ?? null, serverDecision: res.data.decision ?? null,
      });
      setRun((prev) => {
        if (!prev || prev.queueId !== item.id) return prev;
        const same = prev.provisional && res.data.decision === prev.provisional.decision;
        return {
          ...prev,
          result: res.data.score != null ? reconstruct(res.data, prev.profileLocal, prev.exact) : prev.result,
          resultKind: 'confirmed', sync: same ? 'confirmed-same' : 'confirmed-changed',
        };
      });
    }
    rt.saveQueue(remaining);
    setQueue(remaining);
    await refreshRecord();
    setBusy(false);
  }, [log, refreshRecord]);

  useEffect(() => { if (net !== 'offline' && rt.loadQueue().length) flushQueue(); }, [net, flushQueue]);

  // ---- the pipeline ------------------------------------------------------------------------------
  async function onRun() {
    const errs = profileErrors(profile);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    setStatus('');
    const stampAtRun = stamp;
    try {
      const clean = normalizeProfile(profile);

      if (mode === 'traditional') {
        setStage(-1);
        if (net === 'offline') {
          setRun({ stamp: stampAtRun, mode, error: 'You are offline. A traditional app needs the server for everything, so nothing works.' });
          await log('RUN_FAILED', { mode, reason: 'offline' });
          return;
        }
        if (net === 'slow') await rt.sleep(SLOW_EXTRA_MS);
        const body = { session, mode: 'traditional', profile: clean };
        await log('TRANSMIT_RAW', { mode, fields: Object.keys(clean).length, bytes: payloadBytes(body) });
        const res = await rt.sendTraditional(body);
        await refreshRecord();
        if (!res.ok) {
          setRun({ stamp: stampAtRun, mode, error: res.data?.error ?? res.error ?? `HTTP ${res.status}` });
          return;
        }
        setRun({
          stamp: stampAtRun, mode, metrics: tradMetrics, resultKind: 'confirmed',
          result: { ...res.data, reasonCodes: res.data.reasonCodes ?? [], localDetail: null },
        });
        setStatus(`Sent ${payloadBytes(body)} bytes, ${res.ms} ms round trip`);
        return;
      }

      // ---- DataShadow ----
      setStage(0);
      await rt.sleep(PACE_MS);
      const probed = net === 'offline' ? null : await rt.probeRtt();
      const apiDown = net !== 'offline' && probed == null;
      const netNow = net === 'offline' || apiDown
        ? { online: false, rttMs: Infinity }
        : { online: true, rttMs: Math.max(5, probed) + (net === 'slow' ? SLOW_EXTRA_MS : 0) };
      if (probed != null) setRtt(Math.max(5, probed));

      setStage(1);
      await rt.sleep(PACE_MS);
      const tPlan = performance.now();
      let runPlan = planAll(makeContext({ classifications, policy: DEFAULT_POLICY, network: netNow, consent }));
      const planMs = performance.now() - tPlan;
      await log('PLAN', {
        decisions: Object.fromEntries(runPlan.map((e) => [e.id, e.decision])),
        network: { online: netNow.online, rttMs: Number.isFinite(netNow.rttMs) ? Math.round(netNow.rttMs) : null },
        consent,
      });

      setStage(2);
      await rt.sleep(PACE_MS);
      const epsilon = privacy === 'strict' ? STRICT_EPS : Infinity;
      const tLocal = performance.now();
      const local = await rt.runLocal({
        profile: clean, plan: runPlan, epsilon, budgetSnap: rt.loadBudget(), now: Date.now(),
      });
      const localMs = performance.now() - tLocal;
      rt.saveBudget(local.budget);
      setBudget(local.budget);
      runPlan = applyWithheld(runPlan, local.withheld);
      await log('LOCAL_COMPUTE', {
        computations: Object.keys(local.timings), epsilonSpent: local.epsilonSpent, withheld: local.withheld.map((w) => w.id),
      });

      const payload = buildPayload(clean, runPlan, local.released, { consent, session });
      const metrics = measurePayload(payload, clean, classifications);
      const provisional = local.provisional ? reconstruct(local.provisional, clean, local.exact) : null;
      const base = {
        stamp: stampAtRun, mode, plan: runPlan, payload, metrics, provisional, exact: local.exact, profileLocal: clean,
      };

      setStage(3);
      await rt.sleep(PACE_MS);

      if (!netNow.online) {
        const queueable = payload.ops.length > 0;
        const id = `q-${Date.now()}`;
        if (queueable) {
          const q = [...rt.loadQueue(), { id, payload, provisional: local.provisional }];
          rt.saveQueue(q);
          setQueue(q);
          await log('QUEUED', { id, ops: payload.ops, fields: Object.keys(payload.features), bytes: payloadBytes(payload) });
        }
        setRun({
          ...base, queueId: queueable ? id : null, result: provisional, resultKind: provisional ? 'provisional' : null,
          sync: queueable ? 'queued' : null, error: apiDown ? 'The API is unreachable, so this ran offline.' : null,
        });
        setStatus(`Nothing left the device. Planned in ${planMs.toFixed(1)} ms, computed in ${localMs.toFixed(1)} ms`);
        return;
      }

      if (payload.ops.length === 0) {
        setRun({ ...base, result: provisional, resultKind: provisional ? 'provisional' : null, sync: null });
        setStatus('Nothing to send: the privacy budget withheld required inputs.');
        return;
      }

      if (provisional) setRun({ ...base, result: provisional, resultKind: 'provisional', sync: 'pending' });
      await log('TRANSMIT', {
        mode, ops: payload.ops, fields: Object.keys(payload.features), bytes: payloadBytes(payload),
        rawSensitiveFieldsExposed: metrics.exposedFields,
      });
      if (net === 'slow') await rt.sleep(SLOW_EXTRA_MS);
      const res = await rt.sendDataShadow(payload);
      await refreshRecord();
      if (!res.ok) {
        const msg = res.data?.errors ? `The server rejected the request: ${res.data.errors.join('; ')}` : (res.error ?? `HTTP ${res.status}`);
        await log('REJECTED', { status: res.status, errors: res.data?.errors ?? null });
        setRun({ ...base, result: provisional, resultKind: provisional ? 'provisional' : null, error: msg });
        return;
      }
      setStage(4);
      await rt.sleep(PACE_MS);
      const final = res.data.score != null ? reconstruct(res.data, clean, local.exact) : provisional;
      const sync = provisional
        ? (res.data.decision === provisional.decision ? 'confirmed-same' : 'confirmed-changed') : null;
      await log('RESULT', { decision: res.data.decision ?? null, serviceable: res.data.serviceable, ms: res.ms });
      setRun({ ...base, result: final ? { ...final, serviceable: res.data.serviceable, bureau: res.data.bureau } : null, resultKind: 'confirmed', sync });
      setStatus(`Sent ${payloadBytes(payload)} bytes, ${res.ms} ms round trip, computed locally in ${localMs.toFixed(1)} ms`);
    } finally {
      setBusy(false);
      setStage((s) => (s >= 0 ? 5 : s));
    }
  }

  // ---- misc handlers -----------------------------------------------------------------------------
  const setField = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  const onReset = async () => {
    ledgerRef.current.entries.length = 0;
    rt.saveLedger(ledgerRef.current);
    setEntries([]);
    setTampered(false);
    rt.saveBudget(rt.freshBudgetSnap());
    setBudget(rt.freshBudgetSnap());
    rt.saveQueue([]);
    setQueue([]);
    await rt.clearReceived(session);
    setRecord(null);
    setRun(null);
    setStage(-1);
    setStatus('');
  };

  const flagKeys = mode === 'traditional' ? profileFlags : (run?.metrics?.exposedFields ?? []);

  return (
    <>
      <div className="scene" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <svg className="lens-defs" aria-hidden="true" focusable="false">
        <filter id="liquid-lens" x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    <div className="page">
      <header className="masthead">
        <div className="brand"><Logo /><span>DataShadow</span></div>
        <span className="track">Hackathon track SNH-WD-03: zero-trust personal data</span>
      </header>

      <section className="intro">
        <h1>Check loan eligibility without handing over your Aadhaar, PAN or income.</h1>
        <p>
          The sensitive work happens inside this browser. The server only receives coarse bands, and this page shows you
          exactly which ones. Change the form, press Check eligibility, then switch to the traditional flow to compare.
        </p>
      </section>

      <div className="toolbar" role="group" aria-label="Scenario controls">
        <Segmented
          label="How it is processed" value={mode} onChange={setMode}
          options={[
            { value: 'traditional', label: 'Traditional', hint: 'Send the whole profile to the server' },
            { value: 'datashadow', label: 'DataShadow', hint: 'Classify, plan, minimise' },
          ]}
        />
        <Segmented
          label="Connection" value={net} onChange={setNet}
          options={[
            { value: 'online', label: 'Online' },
            { value: 'slow', label: 'Slow' },
            { value: 'offline', label: 'Offline' },
          ]}
        />
        <Segmented
          label="Privacy level" value={privacy} onChange={setPrivacy}
          options={[
            { value: 'standard', label: 'Standard', hint: 'Bands only' },
            { value: 'strict', label: 'Strict', hint: `Bands plus local differential privacy, ε=${STRICT_EPS} per band` },
          ]}
        />
        <Toggle
          label="Allow bureau lookup (sends PAN)" checked={consent.bureau}
          onChange={(v) => setConsent({ bureau: v })} hint="Policy R2: PAN may leave the device only with explicit consent"
        />
        <div className="cta">
          <button type="button" className="btn primary" onClick={onRun} disabled={busy}>
            {busy ? 'Checking…' : 'Check eligibility'}
          </button>
        </div>
      </div>
      <p className="status" role="status" aria-live="polite">{status}</p>

      <Stepper stage={stage} mode={mode} offline={run?.sync === 'queued'} />

      {run?.error && run.result == null && <p className="banner" role="alert">{run.error}</p>}

      <main className="layout">
        <DataPanel
          profile={profile} onChange={setField} classifications={classifications} plan={plan} mode={mode}
          features={features} errors={errors}
          onSample={() => setProfile({ ...SAMPLE_PROFILE })}
          onRandom={() => setProfile({ ...generateProfile(secureRng()) })}
        />
        <div className="side">
          <Verdict run={run} tradMetrics={tradMetrics} queueLen={queue.length} onSync={flushQueue} busy={busy} />
          <PlanPanel plan={plan} mode={mode} stale={!fresh} budget={budget} strict={privacy === 'strict'} network={network} />
        </div>
      </main>

      <div className="lower insight">
        <ExplainPanel run={run} strict={privacy === 'strict'} />
        <EvalPanel />
      </div>

      <div className="lower">
        <RequestPanel record={record} flagKeys={flagKeys} queued={run?.sync === 'queued'} />
        <LedgerPanel
          entries={entries} chain={chain} tampered={tampered} onTamper={() => setTampered((t) => !t)} onReset={onReset}
        />
      </div>

      <footer className="foot">
        Built with React, Vite and Express. No external AI models or APIs run at runtime; the classifier, planner and
        privacy mechanisms are rule-based and live in <code>packages/core</code>. All applicant data is fictional.
      </footer>
    </div>
    </>
  );
}
