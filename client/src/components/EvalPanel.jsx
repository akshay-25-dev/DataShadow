import data from '../data/eval-results.json';

const fmt = (e) => (typeof e === 'number' ? e : null);

function Bar({ pct, tone, label, value }) {
  return (
    <div className="ev-bar">
      <span className="ev-label">{label}</span>
      <span className="ev-track" role="img" aria-label={`${label}: ${value}`}><i className={tone} style={{ width: `${Math.max(2, pct)}%` }} /></span>
      <b className="ev-value num">{value}</b>
    </div>
  );
}

export default function EvalPanel() {
  const { leakage: L, accuracy, leakage: { profiles }, seed } = data;
  const maxExposed = Math.max(L.traditional.avgSensitiveFieldsExposed, 1);
  return (
    <section className="card evalp" aria-labelledby="ev-h">
      <header className="card-head">
        <div>
          <h2 id="ev-h">What privacy costs in accuracy</h2>
          <p className="cap">Measured on {profiles.toLocaleString('en-IN')} made-up applicants (fixed seed {seed}, rerun with <code>npm run eval</code>).</p>
        </div>
      </header>

      <h3 className="ev-h3">Sensitive fields sent per request</h3>
      <Bar tone="red" label="Traditional" pct={(L.traditional.avgSensitiveFieldsExposed / maxExposed) * 100} value={L.traditional.avgSensitiveFieldsExposed.toFixed(1)} />
      <Bar tone="teal" label="DataShadow" pct={0} value={L.datashadow.avgSensitiveFieldsExposed.toFixed(1)} />
      <p className="cap">Request size is about the same ({L.traditional.avgPayloadBytes} bytes vs {L.datashadow.avgPayloadBytes}), so privacy is not paid for in bandwidth.</p>

      <h3 className="ev-h3">How often the decision matches the exact-value score</h3>
      <div className="ev-rows">
        {accuracy.map((a) => {
          const eps = fmt(a.epsilonPerFeature);
          const name = eps == null ? 'Bands only (Standard)' : eps === 2 ? 'Strict, ε=2 (app default)' : `Strict, ε=${eps}`;
          return <Bar key={name} tone={eps == null ? 'indigo' : eps === 2 ? 'amber' : 'plain'} label={name} pct={a.decisionAgreementPct} value={`${a.decisionAgreementPct}%`} />;
        })}
      </div>
      <p className="cap">
        Smaller ε means more random noise added to each band, so stronger privacy and less accurate decisions. At the Strict
        default, about {Math.round(100 - accuracy.find((a) => a.epsilonPerFeature === 2).decisionAgreementPct)} in 100 decisions differ from the exact-value
        score. Bands alone cost about {Math.round(100 - accuracy[0].decisionAgreementPct)} in 100, and the model's own thresholds sit close to many applicants' scores.
      </p>
    </section>
  );
}
