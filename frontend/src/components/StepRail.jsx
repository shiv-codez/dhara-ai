import { STEPS, LAYER_DEFS } from '../lib/steps.js'
import { translate } from '../lib/i18n.js'

export default function StepRail({
  stepIdx,
  onStep,
  playing,
  onPlay,
  onStop,
  vis,
  onToggleLayer,
  regMode,
  onRegMode,
  fixMode,
  onFixMode,
  manifest,
  lang = 'en',
  onClose,
}) {
  const step = STEPS[stepIdx]
  const reg = manifest?.regularisation
  const topo = manifest?.topology || { before_fix: {}, after_fix: {} }
  const beforeFix = topo.before_fix || {}
  const afterFix = topo.after_fix || {}

  function getStepTitle(s) {
    const key = `step_${s.id}_title`
    const trans = translate(key, lang)
    return trans !== key ? trans : s.title
  }

  function getStepBlurb(s) {
    const key = `step_${s.id}_blurb`
    const trans = translate(key, lang)
    return trans !== key ? trans : s.blurb
  }

  function getLayerLabel(l) {
    const key = `layer_${l.key}`
    const trans = translate(key, lang)
    return trans !== key ? trans : l.label
  }

  return (
    <aside className="rail" aria-label={translate('pipeline_rail', lang)}>
      <div className="rail-head">
        <button
          className={`btn primary wide ${playing ? 'is-playing' : ''}`}
          onClick={playing ? onStop : onPlay}
        >
          {playing ? translate('stop_walkthrough', lang) : translate('play_pipeline', lang)}
        </button>
        {onClose && (
          <button
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close pipeline drawer"
            title="Close drawer"
          >
            ✕
          </button>
        )}
      </div>

      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className={`step ${i === stepIdx ? 'active' : ''} ${i < stepIdx ? 'done' : ''}`}>
            <button className="step-btn" onClick={() => onStep(i)} aria-current={i === stepIdx ? 'step' : undefined}>
              <span className="step-no" aria-hidden="true">{i + 1}</span>
              <span className="step-title">{getStepTitle(s)}</span>
            </button>
            {i === stepIdx && (
              <div className="step-body">
                <p>{getStepBlurb(s)}</p>

                {s.regToggle && (
                  <>
                    <div className="seg" role="group" aria-label={translate('polygon_cleanup', lang)}>
                      <button className={regMode === 'raw' ? 'on' : ''} onClick={() => onRegMode('raw')}>
                        {translate('raw_mask', lang)}
                      </button>
                      <button className={regMode === 'clean' ? 'on' : ''} onClick={() => onRegMode('clean')}>
                        {translate('clean_polygons', lang)}
                      </button>
                    </div>
                    {reg && (
                      <dl className="mini-stats">
                        <div>
                          <dt>{translate('vertices', lang)}</dt>
                          <dd>
                            {reg.vertices_raw?.toLocaleString('en-IN') ?? '—'} <i>{translate('to', lang)}</i> {reg.vertices_regularised?.toLocaleString('en-IN') ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>{translate('right_angles', lang)}</dt>
                          <dd>
                            {Math.round((reg.right_angle_share_simplified_only || 0) * 100)}% <i>{translate('to', lang)}</i> {Math.round((reg.right_angle_share_regularised || 0) * 100)}%
                          </dd>
                        </div>
                      </dl>
                    )}
                    <p className="fine">{translate('regularisation_note', lang)}</p>
                  </>
                )}

                {s.fixToggle && (
                  <>
                    <div className="seg" role="group" aria-label={translate('auto_fix', lang)}>
                      <button className={fixMode === 'before' ? 'on' : ''} onClick={() => onFixMode('before')}>
                        {translate('before_autofix', lang)}
                      </button>
                      <button className={fixMode === 'after' ? 'on' : ''} onClick={() => onFixMode('after')}>
                        {translate('after_autofix', lang)}
                      </button>
                    </div>
                    <p className="fine">
                      {translate('flags_count', lang)}: {Object.values(beforeFix).reduce((a, b) => a + b, 0)} {translate('before', lang)}, {Object.values(afterFix).reduce((a, b) => a + b, 0)} {translate('after', lang)}. {translate('autofix_note', lang)}
                    </p>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>

      <fieldset className="layers">
        <legend>{translate('layers', lang)}</legend>
        {LAYER_DEFS.map((l) => (
          <label key={l.key} className="check">
            <input type="checkbox" checked={!!vis[l.key]} onChange={() => onToggleLayer(l.key)} />
            <span>{getLayerLabel(l)}</span>
          </label>
        ))}
      </fieldset>
    </aside>
  )
}
