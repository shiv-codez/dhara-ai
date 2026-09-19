import { STEPS, LAYER_DEFS } from '../lib/steps.js'

export default function StepRail({ stepIdx, onStep, playing, onPlay, onStop, vis, onToggleLayer, regMode, onRegMode, fixMode, onFixMode, manifest }) {
  const step = STEPS[stepIdx]
  const reg = manifest?.regularisation
  const topo = manifest?.topology || { before_fix: {}, after_fix: {} }
  const beforeFix = topo.before_fix || {}
  const afterFix = topo.after_fix || {}
  return (
    <aside className="rail" aria-label="Pipeline">
      <div className="rail-head">
        <button className={`btn primary wide ${playing ? 'is-playing' : ''}`} onClick={playing ? onStop : onPlay}>
          {playing ? 'Stop walkthrough' : 'Play the pipeline'}
        </button>
      </div>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={`step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}>
            <button className="step-btn" onClick={() => onStep(i)} aria-current={i === stepIdx ? 'step' : undefined}>
              <span className="step-no" aria-hidden="true">{i + 1}</span>
              <span className="step-title">{s.title}</span>
            </button>
            {i === stepIdx && (
              <div className="step-body">
                <p>{s.blurb}</p>

                {s.regToggle && (
                  <>
                    <div className="seg" role="group" aria-label="Polygon cleanup">
                      <button className={regMode === 'raw' ? 'on' : ''} onClick={() => onRegMode('raw')}>Raw mask outline</button>
                      <button className={regMode === 'clean' ? 'on' : ''} onClick={() => onRegMode('clean')}>Cleaned polygons</button>
                    </div>
                    {reg && (
                      <dl className="mini-stats">
                        <div><dt>Vertices</dt><dd>{reg.vertices_raw?.toLocaleString('en-IN') ?? '—'} <i>to</i> {reg.vertices_regularised?.toLocaleString('en-IN') ?? '—'}</dd></div>
                        <div><dt>Right-angle corners</dt><dd>{Math.round((reg.right_angle_share_simplified_only || 0) * 100)}% <i>to</i> {Math.round((reg.right_angle_share_regularised || 0) * 100)}%</dd></div>
                      </dl>
                    )}
                    <p className="fine">Right-angle share compares simplification alone with simplification plus edge fitting, within 5 degrees.</p>
                  </>
                )}

                {s.fixToggle && (
                  <>
                    <div className="seg" role="group" aria-label="Auto-fix">
                      <button className={fixMode === 'before' ? 'on' : ''} onClick={() => onFixMode('before')}>Before auto-fix</button>
                      <button className={fixMode === 'after' ? 'on' : ''} onClick={() => onFixMode('after')}>After auto-fix</button>
                    </div>
                    <p className="fine">
                      Flags: {Object.values(beforeFix).reduce((a, b) => a + b, 0)} before, {Object.values(afterFix).reduce((a, b) => a + b, 0)} after.
                      Auto-fix only resolves parcel overlaps; everything else is left for the officer.
                    </p>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <fieldset className="layers">
        <legend>Layers</legend>
        {LAYER_DEFS.map((l) => (
          <label key={l.key} className="check">
            <input type="checkbox" checked={!!vis[l.key]} onChange={() => onToggleLayer(l.key)} />
            <span>{l.label}</span>
          </label>
        ))}
      </fieldset>
    </aside>
  )
}
