import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  validatePayload, scoreDerived, scoreRaw, computeExactFeatures, payloadBytes,
} from '@datashadow/core';
import { MemoryStore } from './store.js';

// Server-side reference data. This is why region_check must run remotely: the client doesn't have it.
const SERVICEABLE_PREFIXES = new Set([
  '110', '121', '122', '201', '226', '302', '380', '400', '401', '411', '500', '560', '600', '700',
]);

// SIMULATED bureau: deterministic pseudo-score from the PAN. A real integration would call a bureau API.
export function simulatedBureauBand(pan) {
  const sum = [...pan].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 10;
  return sum < 5 ? 'good' : sum < 8 ? 'fair' : 'poor';
}

const safeSession = (s) => (typeof s === 'string' && /^[\w-]{8,64}$/.test(s) ? s : 'anon');

export function createApp({ store = new MemoryStore(), staticDir } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, t: Date.now() }));

  // DataShadow route: accepts ONLY the allowlisted, minimised payload.
  app.post('/api/score', (req, res) => {
    const body = req.body;
    const session = safeSession(body?.session);
    const v = validatePayload(body);
    if (!v.ok) {
      // Log keys and errors only, never values: a rejected payload may itself contain PII.
      store.add(session, {
        ts: new Date().toISOString(), route: '/api/score', rejected: true, errors: v.errors,
        keys: Object.keys(body?.features ?? {}),
      });
      return res.status(422).json({ error: 'payload_rejected', errors: v.errors });
    }
    const f = body.features;
    const out = { requestId: randomUUID(), mode: 'datashadow', serviceable: null, bureau: null };
    try {
      if (body.ops.includes('bureau_lookup')) {
        out.bureau = simulatedBureauBand(f.pan);
        out.bureauSimulated = true;
      }
      if (body.ops.includes('risk_score')) {
        Object.assign(out, scoreDerived({ ...f, bureau_band: out.bureau ?? undefined }));
      }
      if (body.ops.includes('region_check')) out.serviceable = SERVICEABLE_PREFIXES.has(f.region3);
    } catch (e) {
      return res.status(422).json({ error: 'payload_rejected', errors: [e.message] });
    }
    const bytes = payloadBytes(body);
    out.receivedBytes = bytes;
    store.add(session, { ts: new Date().toISOString(), route: '/api/score', bytes, body, result: out });
    return res.json(out);
  });

  // BASELINE ONLY: a "traditional" server that accepts the whole raw profile. Exists so the demo can show
  // exactly what DataShadow avoids. Never enable this in a real deployment.
  app.post('/api/score-traditional', (req, res) => {
    const body = req.body;
    const session = safeSession(body?.session);
    if (!body || typeof body.profile !== 'object' || body.profile === null) {
      return res.status(422).json({ error: 'profile required' });
    }
    const exact = computeExactFeatures(body.profile);
    if (!Number.isFinite(exact.age)) return res.status(422).json({ error: 'invalid profile' });
    const bureau = body.profile.pan ? simulatedBureauBand(String(body.profile.pan)) : undefined;
    const result = scoreRaw({ ...exact, bureau });
    const prefix = String(body.profile.pincode ?? '').slice(0, 3);
    const out = {
      requestId: randomUUID(), mode: 'traditional', ...result,
      serviceable: SERVICEABLE_PREFIXES.has(prefix), bureau: bureau ?? null, bureauSimulated: !!bureau,
    };
    const bytes = payloadBytes(body);
    out.receivedBytes = bytes;
    store.add(session, { ts: new Date().toISOString(), route: '/api/score-traditional', bytes, body, result: out });
    return res.json(out);
  });

  app.get('/api/received', (req, res) => {
    res.json({ records: store.list(safeSession(req.query.session)) });
  });
  app.delete('/api/received', (req, res) => {
    store.clear(safeSession(req.query.session));
    res.json({ ok: true });
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
