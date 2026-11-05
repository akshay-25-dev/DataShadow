import { FEATURES, BASE_SCORE, scoreRaw, computeExactFeatures, DEFAULT_POLICY } from '@datashadow/core';
import { prettyBand, KEY_NAMES } from '../lib/format.js';

const MAX_PTS = 100; // widest swing any single factor can have, used to scale the bars
const EMP = { salaried: 'Salaried', self_employed: 'Self-employed', other: 'Other' };
const BUREAU = { good: 'Good', fair: 'Fair', poor: 'Poor' };

function rowsFor(run) {
  const parts = run.result.parts;
  const feats = run.payload?.features ?? {};
  const rows = [];
  for (const [name, spec] of Object.entries(FEATURES)) {
    if (parts[name] == null) continue;
    rows.push({ id: name, label: KEY_NAMES[spec.key], saw: feats[spec.key] != null ? prettyBand(spec.key, feats[spec.key]) : '–', pts: parts[name] });
  }
  if (parts.employment != null) rows.push({ id: 'employment', label: 'Employment', saw: EMP[feats.employment_type] ?? 'Other', pts: parts.employment });
  if (parts.bureau != null) rows.push({ id: 'bureau', label: 'Credit bureau (simulated)', saw: BUREAU[run.result.bureau] ?? '–', pts: parts.bureau });
  return rows;
}

function exactScore(run) {
  try {
    const f = computeExactFeatures(run.profileLocal);
    return scoreRaw({ ...f, bureau: run.result.bureau ?? undefined }).score;
  } catch { return null; }
}

const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

export default function ExplainPanel({ run, strict }) {
  const ok = run?.mode === 'datashadow' && run.result?.parts && run.payload;
  const rows = ok ? rowsFor(run) : [];
  const sum = rows.reduce((a, r) => a + r.pts, 0);
  const raw = ok ? exactScore(run) : null;
  const eps = DEFAULT_POLICY.privacy.strictPerFeatureEpsilon;
  return (
    <section className="card explain" aria-labelledby="ex-h">
      <h2 id="ex-h">How the score is worked out</h2>
      <p className="cap">
        Every score starts at {BASE_SCORE}. Each factor then adds or removes points. The server only knows the band you
        fall in, so it scores the middle of that band.
      </p>
      {!ok ? (
        <div className="empty"><strong>No score to explain yet</strong><p>Run Check eligibility in DataShadow mode and the point-by-point breakdown appears here.</p></div>
      ) : (
        <>
          <ol className="ex-rows">
            <li className="ex-row ex-base"><span className="ex-name">Starting score</span><span /><span className="ex-pts num">{BASE_SCORE}</span></li>
            {rows.map((r) => (
              <li key={r.id} className="ex-row">
                <span className="ex-name">{r.label}</span>
                <span className="ex-saw"><span className="chip plain"><span className="chip-v">{r.saw}</span></span></span>
                <span className="ex-bar" role="img" aria-label={`${sign(r.pts)} points`}>
                  <i className="ex-axis" />
                  <i className={`ex-fill ${r.pts >= 0 ? 'pos' : 'neg'}`} style={{ '--k': Math.min(0.5, (Math.abs(r.pts) / MAX_PTS) * 0.5) }} />
                  <b className="ex-val num">{sign(r.pts)}</b>
                </span>
              </li>
            ))}
            <li className="ex-row ex-total"><span className="ex-name">Final score</span><span className="ex-sum num">{BASE_SCORE} {sign(sum)}</span><span className="ex-pts num">{run.result.score}</span></li>
          </ol>
          <div className="ex-notes">
            <p><strong>Decision rule.</strong> 700 or more: likely approve. 600 to 699: manual review. Below 600: likely decline. Scores are kept between 300 and 900.</p>
            {raw != null && (
              <p>
                <strong>What banding costs.</strong> With your exact figures a traditional app would score {raw}. DataShadow scored {run.result.score}
                {raw === run.result.score ? ', exactly the same' : `, ${Math.abs(raw - run.result.score)} point${Math.abs(raw - run.result.score) === 1 ? '' : 's'} ${run.result.score < raw ? 'lower' : 'higher'}`}.
                {strict && ` Strict mode also randomly shifts some bands (privacy level ε=${eps} each), so this gap can be larger.`}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
