import { PROFILE_FIELDS } from '@datashadow/core';
import { KEY_NAMES, prettyValue, seesFor } from '../lib/format.js';

const SENS = ['Not sensitive', 'Low', 'Medium', 'High', 'Critical'];

function Sees({ info, value }) {
  if (info.kind === 'none') {
    const w = Math.min(170, Math.max(84, String(value ?? '').length * 7 + 44));
    return (
      <div className="sees">
        <span className="redact" style={{ width: w }}><span>Not sent</span></span>
      </div>
    );
  }
  return (
    <div className="sees chips">
      {info.items.map((it) => {
        const name = it.name ?? KEY_NAMES[it.key] ?? it.key;
        const shown = it.text ?? prettyValue(it.key, it.value);
        const tone = info.kind === 'raw' ? (info.sensitive ? 'exposed' : 'plain') : 'band';
        return (
          <span key={it.key} className={`chip ${tone} ${shown == null ? 'pending' : ''}`}>
            <span className="chip-k">{name}</span>
            {shown != null && <span className="chip-v">{shown}</span>}
          </span>
        );
      })}
    </div>
  );
}

export default function DataPanel({ profile, onChange, classifications, plan, mode, features, onSample, onRandom, errors }) {
  const groups = [...new Set(PROFILE_FIELDS.map((f) => f.group))];
  return (
    <section className="card sheet" aria-labelledby="d-h">
      <header className="card-head">
        <div>
          <h2 id="d-h">Your data, and what the server sees</h2>
          <p className="cap">Edit the fictional applicant on the left. The right column updates to show what would leave this browser.</p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn quiet" onClick={onSample}>Reset sample</button>
          <button type="button" className="btn quiet" onClick={onRandom}>Random applicant</button>
        </div>
      </header>

      {errors.length > 0 && (
        <ul className="errors" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      <div className="cols-head" aria-hidden="true">
        <span>Field</span><span>You typed (stays in this browser)</span><span>What the server sees</span>
      </div>

      {groups.map((g) => (
        <div className="group" key={g}>
          <h3>{g}</h3>
          {PROFILE_FIELDS.filter((f) => f.group === g).map((f) => {
            const c = classifications[f.key];
            const id = `f-${f.key}`;
            const info = seesFor(f.key, { plan, features, cls: c, mode, profile });
            return (
              <div className="row" key={f.key}>
                <div className="lab">
                  <label htmlFor={id}>{f.label}</label>
                  <span className={`sens s${c.sensitivity}`} title={`${c.label}, detected from ${c.via.join(' + ') || 'no signal'}`}>
                    {SENS[c.sensitivity]}
                  </span>
                </div>
                <div className="inp">
                  {f.type === 'select' ? (
                    <select id={id} value={profile[f.key]} onChange={(e) => onChange(f.key, e.target.value)}>
                      {f.options.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea id={id} rows={2} value={profile[f.key]} onChange={(e) => onChange(f.key, e.target.value)} />
                  ) : (
                    <input
                      id={id} type={f.type} value={profile[f.key]} spellCheck="false" autoComplete="off"
                      onChange={(e) => onChange(f.key, e.target.value)}
                    />
                  )}
                </div>
                <Sees info={info} value={profile[f.key]} />
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
