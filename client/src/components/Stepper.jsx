const STEPS = [
  ['Classify', 'Label every field by how sensitive it is'],
  ['Decide', 'Pick device or server for each calculation'],
  ['Minimise', 'Shrink exact values into coarse bands'],
  ['Send', 'Send only those bands to the server'],
  ['Rebuild', 'Combine the answer with exact values here'],
];

/** stage: -1 idle, 0..4 running that step, 5 finished. */
export default function Stepper({ stage, mode, offline }) {
  const dim = mode === 'traditional';
  return (
    <ol className={`stepper ${dim ? 'dim' : ''}`} aria-label="Pipeline steps">
      {STEPS.map(([title, desc], i) => {
        const skipped = offline && i === 3 && stage === 5;
        const state = dim ? 'todo' : skipped ? 'skipped' : stage > i || stage === 5 ? 'done' : stage === i ? 'active' : 'todo';
        return (
          <li key={title} className={state} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="dot" aria-hidden="true">{state === 'done' ? '✓' : skipped ? '–' : i + 1}</span>
            <span className="st-text">
              <strong>{skipped ? 'Queue' : title}</strong>
              <small>{skipped ? 'Offline, so nothing was sent. Saved on this device.' : desc}</small>
            </span>
          </li>
        );
      })}
      {dim && <li className="dim-note">The traditional flow skips all five steps. Everything is posted as typed.</li>}
    </ol>
  );
}
