// Browser runtime: persistence, network calls, worker bridge. Nothing here ever persists the raw profile:
// only the privacy budget, the audit ledger and queued *derived* payloads touch localStorage.
import { PrivacyBudget, AuditLedger, DEFAULT_POLICY } from '@datashadow/core';

const K = { budget: 'ds.budget.v1', ledger: 'ds.ledger.v1', queue: 'ds.queue.v1', session: 'ds.session.v1' };

const read = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch { return d; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable: run in-memory */ }
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function getSession() {
  let s = read(K.session, null);
  if (!s) {
    s = `sess-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    write(K.session, s);
  }
  return s;
}

export const freshBudgetSnap = () => ({ total: DEFAULT_POLICY.privacy.totalEpsilon, spent: 0, ledger: [], memo: {} });
export const loadBudget = () => PrivacyBudget.from(read(K.budget, freshBudgetSnap())).snapshot();
export const saveBudget = (snap) => write(K.budget, snap);

export const loadLedger = () => new AuditLedger(read(K.ledger, []));
export const saveLedger = (ledger) => write(K.ledger, ledger.entries.slice(-300));

export const loadQueue = () => read(K.queue, []);
export const saveQueue = (q) => write(K.queue, q);

async function jsonFetch(url, opts) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, opts);
    let data = null;
    try { data = await r.json(); } catch { /* non-JSON body */ }
    return { ok: r.ok, status: r.status, data, ms: Math.round(performance.now() - t0) };
  } catch (e) {
    return { ok: false, status: 0, data: null, ms: Math.round(performance.now() - t0), error: String(e?.message ?? e) };
  }
}
const postJson = (url, body) => jsonFetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

/** Median RTT over a few health pings, or null if the API is unreachable. */
export async function probeRtt(n = 3) {
  const times = [];
  for (let i = 0; i < n; i++) {
    const r = await jsonFetch('/api/health', { cache: 'no-store' });
    if (!r.ok) return null;
    times.push(r.ms);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

export const sendDataShadow = (payload) => postJson('/api/score', payload);
export const sendTraditional = (body) => postJson('/api/score-traditional', body);
export const fetchReceived = async (session) => (await jsonFetch(`/api/received?session=${session}`)).data?.records ?? [];
export const clearReceived = (session) => jsonFetch(`/api/received?session=${session}`, { method: 'DELETE' });

// ---- worker bridge -------------------------------------------------------------------------------
let worker;
let seq = 0;
const pending = new Map();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, ok, out, error } = ev.data;
      const p = pending.get(id);
      pending.delete(id);
      if (ok) p.resolve(out); else p.reject(new Error(error));
    };
  }
  return worker;
}
export function runLocal(args) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...args });
  });
}
