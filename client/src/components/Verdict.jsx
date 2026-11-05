const DECISION = {
  LIKELY_APPROVE: ['Likely approve', 'teal'],
  MANUAL_REVIEW: ['Needs manual review', 'amber'],
  LIKELY_DECLINE: ['Likely decline', 'red'],
};
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

function LeakRow({ name, pct, tone, note }) {
  const has = pct != null;
  return (
    <div className="leak-row">
      <div className="leak-top">
        <span className="leak-name">{name}</span>
        <span className={`leak-pct ${has ? tone : 'muted'}`}>{has ? `${pct}%` : '–'}</span>
      </div>
      <div className="meter" aria-hidden="true">
        <span className={tone} style={{ width: has ? `${pct === 0 ? 0 : Math.max(pct, 3)}%` : 0 }} />
      </div>
      <p className="leak-note">{note}</p>
    </div>
  );
}

function Gauge({ score }) {
  const pos = Math.min(100, Math.max(0, (score - 300) / 6));
  return (
    <div className="gauge" role="img" aria-label={`Score ${score} out of 900`}>
      <div className="zones"><span className="zr" /><span className="zy" /><span className="zg" /></div>
      <i className="marker" style={{ left: `${pos}%` }} />
      <div className="g-labels"><span style={{ left: 0 }}>300</span><span style={{ left: '50%' }}>600</span><span style={{ left: '66.7%' }}>700</span><span style={{ left: '100%' }}>900</span></div>
    </div>
  );
}

function Outcome({ run, queueLen, onSync, busy }) {
  if (!run) {
    return <div className="empty"><strong>No result yet</strong><p>Press Check eligibility to run the pipeline and see what the server decides.</p></div>;
  }
  if (run.error && !run.result) {
    return <div className="empty err" role="alert"><strong>That didn't work</strong><p>{run.error}</p></div>;
  }
  const r = run.result;
  if (!r) {
    return (
      <div className="empty">
        <strong>No score yet</strong>
        <p>{run.sync === 'queued' ? 'You are offline, so nothing left the device. A derived-only request is queued and will send when you reconnect.' : 'No score was produced.'}</p>
      </div>
    );
  }
  const [dText, tone] = DECISION[r.decision] ?? [r.decision, 'muted'];
  const d = r.localDetail;
  return (
    <div className="outcome">
      <div className="o-top">
        <span className={`o-decision ${tone}`}>{dText}</span>
        <span className="o-score">{r.score}<small> / 900</small></span>
      </div>
      <Gauge score={r.score} />
      <div className="tags">
        {run.resultKind === 'provisional' && <span className="tag amber">Provisional, worked out on your device</span>}
        {run.resultKind === 'confirmed' && <span className="tag teal">Confirmed by the server</span>}
        {run.sync === 'confirmed-same' && <span className="tag teal">Server agrees with the provisional result</span>}
        {run.sync === 'confirmed-changed' && <span className="tag red">Server changed the decision</span>}
        {run.sync === 'queued' && <span className="tag amber">{queueLen} waiting to sync</span>}
        {run.sync === 'pending' && <span className="tag indigo">Confirming with the server</span>}
        {r.serviceable != null && <span className={`tag ${r.serviceable ? 'teal' : 'red'}`}>{r.serviceable ? 'Your area is serviceable' : 'Area not serviceable'}</span>}
        {r.bureau && <span className="tag plain">Bureau band (simulated): {r.bureau}</span>}
      </div>
      {r.reasonCodes.length > 0 && <p className="drivers">Held the score back: {r.reasonCodes.join(', ').toLowerCase().replaceAll('_', ' ')}.</p>}
      {run.error && <p className="drivers warn">{run.error}</p>}
      {d && (
        <div className="exact">
          <h3>Worked out on your device</h3>
          <dl>
            <div><dt>EMI share of income</dt><dd>{d.dtiPct}%</dd></div>
            <div><dt>Card usage</dt><dd>{d.utilPct}%</dd></div>
            <div><dt>New EMI</dt><dd>{inr(d.proposedEmi)}</dd></div>
            <div><dt>Age</dt><dd>{d.ageYears}</dd></div>
          </dl>
          <p className="cap">These exact figures never left the browser. The server only saw bands.</p>
        </div>
      )}
      {queueLen > 0 && <button type="button" className="btn quiet" disabled={busy} onClick={onSync}>Sync {queueLen} queued now</button>}
    </div>
  );
}

export default function Verdict({ run, tradMetrics, queueLen, onSync, busy }) {
  const ds = run?.mode === 'datashadow' ? run.metrics : null;
  return (
    <section className="card verdict" aria-labelledby="v-h">
      <h2 id="v-h">Result</h2>
      <p className="cap">How much sensitive data was sent as typed, and what the check decided.</p>
      <div className="leak">
        <LeakRow
          name="Traditional app" pct={tradMetrics.leakagePct} tone="red"
          note={`${tradMetrics.exposedFields.length} of ${tradMetrics.sensitiveFieldsTotal} sensitive fields would be sent`}
        />
        <LeakRow
          name="DataShadow" pct={ds ? ds.leakagePct : null} tone="teal"
          note={ds
            ? `${ds.exposedFields.length} of ${ds.sensitiveFieldsTotal} sensitive fields sent${ds.exposedFields.length ? ` (${ds.exposedFields.join(', ')})` : ''}`
            : run?.mode === 'traditional' ? 'You ran the traditional flow' : 'Check eligibility to measure'}
        />
      </div>
      <Outcome run={run} queueLen={queueLen} onSync={onSync} busy={busy} />
    </section>
  );
}
