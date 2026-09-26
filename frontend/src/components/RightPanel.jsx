import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { STATUS, ISSUE_LABEL } from '../lib/steps.js'
import { areaM2, boundsOf } from '../lib/geo.js'
import { translate } from '../lib/i18n.js'

const fmt = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })

export const PRIO_RANK = { High: 0, Medium: 1, Low: 2 }

export function sortQueueFeatures(features) {
  if (!features) return []
  return [...features].sort((a, b) => {
    const prA = PRIO_RANK[a.properties.review_priority] ?? 2
    const prB = PRIO_RANK[b.properties.review_priority] ?? 2
    if (prA !== prB) return prA - prB
    const areaA = a.properties.area_m2 || (a.geometry ? areaM2(a) : 0) || 0
    const areaB = b.properties.area_m2 || (b.geometry ? areaM2(b) : 0) || 0
    return areaB - areaA
  })
}

function getStatusLabel(st, lang = 'en') {
  const key = `status_${st || 'draft'}`
  const text = translate(key, lang)
  return text !== key ? text : (STATUS[st]?.label || STATUS.draft.label)
}

function getLanduseLabel(lu, lang = 'en') {
  if (!lu) return '—'
  const lower = String(lu).toLowerCase()
  if (lower.includes('low')) return translate('landuse_builtup_low', lang)
  if (lower.includes('built')) return translate('landuse_builtup', lang)
  if (lower.includes('veg')) return translate('landuse_veg', lang)
  if (lower.includes('vacant') || lower.includes('open')) return translate('landuse_vacant', lang)
  return lu
}

function getIssueLabel(type, lang = 'en') {
  const key = `issue_${type}`
  const text = translate(key, lang)
  return text !== key ? text : (ISSUE_LABEL[type] || type)
}

function getPriorityLabel(prio, lang = 'en') {
  const key = `prio_${(prio || 'low').toLowerCase()}`
  const text = translate(key, lang)
  return text !== key ? text : prio
}

function Pill({ status, lang = 'en' }) {
  const s = STATUS[status] || STATUS.draft
  return <span className="pill" style={{ '--c': s.color }}>{getStatusLabel(status, lang)}</span>
}

function StatusIcon({ status, lang = 'en' }) {
  const st = status || 'draft'
  const label = getStatusLabel(st, lang)
  if (st === 'approved') {
    return (
      <span className="queue-status-icon approved" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      </span>
    )
  }
  if (st === 'flagged') {
    return (
      <span className="queue-status-icon flagged" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      </span>
    )
  }
  if (st === 'rejected') {
    return (
      <span className="queue-status-icon rejected" title={label} aria-label={label}>
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </span>
    )
  }
  return <span className="queue-status-icon draft" title={label} aria-label={label} />
}

/* ------------------------------------------------------------------------------------- parcel queue item */
function QueueRow({ feature, isSelected, statusObj, onSelect, onFocus, lang = 'en' }) {
  const p = feature.properties
  const id = p.parcel_id
  const shortId = id.slice(-4)
  const st = statusObj?.status || 'draft'
  const prio = p.review_priority || 'Low'
  const area = p.area_m2 || (feature.geometry ? Math.round(areaM2(feature) * 10) / 10 : 0)

  const handleClick = () => {
    onSelect(id)
    if (feature.geometry) {
      onFocus(boundsOf(feature))
    }
  }

  return (
    <button
      type="button"
      className={`queue-item ${isSelected ? 'selected' : ''} ${st !== 'draft' ? 'decided' : ''}`}
      onClick={handleClick}
      aria-current={isSelected ? 'true' : undefined}
    >
      <StatusIcon status={st} lang={lang} />
      <div className="queue-item-main">
        <div className="queue-item-title">
          <span className="queue-item-id">{translate('plot', lang)} {shortId}</span>
          <span className={`queue-prio-tag ${prio.toLowerCase()}`}>{getPriorityLabel(prio, lang)}</span>
        </div>
        <div className="queue-item-meta">
          <span>{fmt(area, 0)} m²</span>
          <span className="dot-sep">·</span>
          <span>{getLanduseLabel(p.landuse, lang)}</span>
        </div>
      </div>
      {statusObj?.decided_by === 'bulk' && (
        <span className="badge-bulk" title={translate('approve_low_title', lang)}>{translate('bulk_badge', lang)}</span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------------------------- shortcuts footer */
function ShortcutsFooter({ lang = 'en' }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('dhara:v1:shortcuts-open') === 'true'
    } catch {
      return false
    }
  })

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      try {
        localStorage.setItem('dhara:v1:shortcuts-open', String(next))
      } catch {}
      return next
    })
  }

  return (
    <footer className="shortcuts-footer" aria-label={translate('keyboard_shortcuts', lang)}>
      <button
        type="button"
        className="shortcuts-toggle-btn"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="shortcuts-toggle-left">
          <kbd className="key-cap">?</kbd>
          <span className="shortcuts-heading">{translate('keyboard_shortcuts', lang)}</span>
        </span>
        <span className="shortcuts-toggle-arrow">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="shortcuts-grid">
          <div className="shortcut-cell"><kbd className="key-cap">A</kbd> <span>{translate('shortcut_approve', lang)}</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">F</kbd> <span>{translate('shortcut_field_check', lang)}</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">R</kbd> <span>{translate('shortcut_reject', lang)}</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">N</kbd> <span>{translate('shortcut_next', lang)}</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">E</kbd> <span>{translate('shortcut_edit', lang)}</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">Esc</kbd> <span>{translate('shortcut_deselect', lang)}</span></div>
        </div>
      )}
    </footer>
  )
}

/* ------------------------------------------------------------------------------------- parcel tab */
function ParcelTab({
  parcels,
  parcel,
  statuses,
  onStatus,
  audit,
  issues,
  editing,
  onEditStart,
  onEditDone,
  overlaps,
  onResolve,
  reviewed,
  total,
  onSelect,
  onNextInQueue,
  onBulkApproveOpen,
  bulkUndoState,
  onUndoBulk,
  onFocus,
  lang = 'en',
}) {
  const [note, setNote] = useState('')
  const scrollPosRef = useRef(0)

  const sortedQueue = useMemo(() => (parcels ? sortQueueFeatures(parcels.features) : []), [parcels])

  const unreviewedCount = useMemo(() => {
    return sortedQueue.filter((f) => (statuses[f.properties.parcel_id]?.status || 'draft') === 'draft').length
  }, [sortedQueue, statuses])

  const lowDraftCount = useMemo(() => {
    return sortedQueue.filter((f) => {
      const isLow = f.properties.review_priority === 'Low'
      const isDraft = (statuses[f.properties.parcel_id]?.status || 'draft') === 'draft'
      return isLow && isDraft
    }).length
  }, [sortedQueue, statuses])

  // Preserve single side-body scroll position across decisions and selections
  useEffect(() => {
    const el = document.querySelector('.side-body')
    if (!el) return
    const onScroll = () => {
      scrollPosRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const el = document.querySelector('.side-body')
    if (el) {
      el.scrollTop = scrollPosRef.current
    }
  }, [statuses, parcel])

  const selectedId = parcel?.properties?.parcel_id || null
  const p = parcel?.properties
  const st = (selectedId && statuses[selectedId]) || { status: 'draft' }
  const mine = selectedId ? issues.filter((i) => i.properties.parcel_ids?.split(',').includes(selectedId)) : []
  const log = selectedId ? audit.filter((a) => a.parcel === selectedId).slice(-4).reverse() : []

  const decide = (status) => {
    if (!selectedId) return
    onStatus(selectedId, status, note, 'individual')
    setNote('')
  }

  return (
    <div className="parcel-tab-container">
      {/* Bulk Undo Notification Banner */}
      {bulkUndoState && (
        <div className="bulk-undo-banner" role="status">
          <div className="undo-msg">
            <svg viewBox="0 0 16 16" width="14" height="14" fill="#1E8E5A">
              <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
            </svg>
            <span>{translate('bulk_approved_msg', lang, { count: bulkUndoState.count })}</span>
          </div>
          <button type="button" className="btn btn-sm btn-undo" onClick={onUndoBulk}>
            {translate('undo_bulk', lang)}
          </button>
        </div>
      )}

      {/* Selected Parcel Inspector OR 1-line hint */}
      {parcel ? (
        <div className="parcel-inspector">
          <header className="parcel-head">
            <div>
              <div className="parcel-title-wrap">
                <h2>{translate('plot', lang)} {p.parcel_id.slice(-4)}</h2>
                <button
                  type="button"
                  className="btn-close-parcel"
                  onClick={() => onSelect(null)}
                  title={`${translate('shortcut_deselect', lang)} (Esc)`}
                >
                  ✕
                </button>
              </div>
              <p className="fine">{p.parcel_id}</p>
            </div>
            <Pill status={st.status} lang={lang} />
          </header>

          <dl className="facts">
            <div><dt>{translate('area', lang)}</dt><dd>{fmt(areaM2(parcel), 1)} m²</dd></div>
            <div><dt>{translate('building_coverage', lang)}</dt><dd>{Math.round(p.building_coverage * 100)}%</dd></div>
            <div><dt>{translate('vegetation_share', lang)}</dt><dd>{Math.round(p.vegetation_share * 100)}%</dd></div>
            <div><dt>{translate('land_use', lang)}</dt><dd>{getLanduseLabel(p.landuse, lang)}</dd></div>
            <div><dt>{translate('review_priority', lang)}</dt><dd className={`prio ${p.review_priority.toLowerCase()}`}>{getPriorityLabel(p.review_priority, lang)}</dd></div>
            {p.review_reasons && <div><dt>{translate('why_needs_look', lang)}</dt><dd className="review-reason-text">{p.review_reasons}</dd></div>}
            <div><dt>{translate('segment_quality', lang)}</dt><dd>{fmt(p.sam_quality, 2)}</dd></div>
          </dl>
          <p className="fine">{translate('quality_disclaimer', lang)}</p>

          {mine.length > 0 && (
            <section>
              <h3>{translate('flags_on_plot', lang)}</h3>
              <ul className="flag-list">
                {mine.map((i) => (
                  <li key={i.properties.issue_id}><b>{getIssueLabel(i.properties.type, lang)}.</b> {i.properties.fix}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="section-head-with-action">
              <h3>{translate('boundary', lang)}</h3>
              {!editing && (
                <button type="button" className="btn btn-sm" onClick={onEditStart}>
                  {translate('edit_boundary', lang)} <kbd>E</kbd>
                </button>
              )}
            </div>
            {editing && (
              <div className="edit-box">
                <p>{translate('edit_instructions', lang)}</p>
                {overlaps.length === 0 ? (
                  <p className="ok-line">{translate('no_overlap', lang)}</p>
                ) : (
                  <div className="warn-line">
                    <p><b>{translate('overlap_detected', lang)}</b> {overlaps.map((o) => `${o.with.slice(-4)} by ${fmt(o.area, 1)} m²`).join(', ')}</p>
                    <button type="button" className="btn" onClick={onResolve}>{translate('resolve_overlap', lang)}</button>
                  </div>
                )}
                <button type="button" className="btn primary" onClick={onEditDone}>{translate('done_editing', lang)}</button>
              </div>
            )}
          </section>

          <section>
            <h3>{translate('decision', lang)}</h3>
            <label className="field">
              <span>{translate('note_optional', lang)}</span>
              <textarea
                rows="2"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={translate('note_placeholder', lang)}
              />
            </label>
            <div className="decide">
              <button type="button" className="btn ok" onClick={() => decide('approved')}>
                {translate('approve', lang)} <kbd>A</kbd>
              </button>
              <button type="button" className="btn warn" onClick={() => decide('flagged')}>
                {translate('needs_field_check', lang)} <kbd>F</kbd>
              </button>
              <button type="button" className="btn bad" onClick={() => decide('rejected')}>
                {translate('reject', lang)} <kbd>R</kbd>
              </button>
            </div>
            {st.note && (
              <p className="fine">
                {translate('last_note', lang)} {st.note} {st.decided_by && <span className="provenance-tag">({st.decided_by})</span>}
              </p>
            )}
          </section>

          {log.length > 0 && (
            <section>
              <h3>{translate('history', lang)}</h3>
              <ul className="log">
                {log.map((a, i) => (
                  <li key={i}>
                    <time>{new Date(a.t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time>
                    <span>{a.text}</span>
                    {a.decided_by && <span className="provenance-tag">{a.decided_by}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <div className="empty-parcel-hint">
          <p className="lead">{translate('select_parcel_hint', lang)}</p>
        </div>
      )}

      {/* Review Queue Section */}
      <div className="queue-section">
        <div className="queue-head">
          <div>
            <h3>{translate('review_queue', lang)}</h3>
            <p className="fine">{unreviewedCount} {translate('step_progress_of', lang)} {total} {translate('unreviewed', lang)}</p>
          </div>
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-sm next-btn"
              onClick={onNextInQueue}
              title={translate('next_title', lang)}
            >
              {translate('next', lang)} <kbd>N</kbd>
            </button>
            <button
              type="button"
              className="btn btn-sm bulk-btn"
              onClick={onBulkApproveOpen}
              disabled={lowDraftCount === 0}
              title={translate('approve_low_title', lang)}
            >
              {translate('approve_low', lang)} ({lowDraftCount})
            </button>
          </div>
        </div>

        <div
          className="queue-list"
          tabIndex={0}
          role="region"
          aria-label={translate('review_queue', lang)}
        >
          {sortedQueue.map((f) => {
            const id = f.properties.parcel_id
            return (
              <QueueRow
                key={id}
                feature={f}
                isSelected={id === selectedId}
                statusObj={statuses[id]}
                onSelect={onSelect}
                onFocus={onFocus}
                lang={lang}
              />
            )
          })}
        </div>
      </div>

      {/* Collapsible Keyboard Shortcuts Footer */}
      <ShortcutsFooter lang={lang} />
    </div>
  )
}

/* ------------------------------------------------------------------------------------- checks */
function ChecksTab({ manifest, issues, fixMode, onFocus, lang = 'en' }) {
  const topo = manifest?.topology || { before_fix: {}, after_fix: {} }
  const beforeFix = topo.before_fix || {}
  const afterFix = topo.after_fix || {}
  const types = useMemo(() => [...new Set([...Object.keys(beforeFix), ...Object.keys(afterFix)])], [beforeFix, afterFix])
  const sevRank = { error: 0, warning: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => sevRank[a.properties.severity] - sevRank[b.properties.severity])
  return (
    <div className="checks">
      <table className="tbl">
        <thead>
          <tr>
            <th>{translate('rule', lang)}</th>
            <th>{translate('before', lang)}</th>
            <th>{translate('after', lang)}</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t}>
              <td>{getIssueLabel(t, lang)}</td>
              <td>{beforeFix[t] || 0}</td>
              <td>{afterFix[t] || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">
        {translate('checks_explanation', lang, { mode: fixMode === 'before' ? translate('before', lang) : translate('after', lang) })}
      </p>
      <ul className="issue-list">
        {sorted.map((i) => (
          <li key={i.properties.issue_id}>
            <button onClick={() => onFocus(boundsOf(i))}>
              <span className={`dot ${i.properties.severity}`} aria-hidden="true" />
              <span>
                <b>{getIssueLabel(i.properties.type, lang)}</b>
                <span className="msg">{i.properties.message}</span>
              </span>
            </button>
          </li>
        ))}
        {sorted.length === 0 && <li className="fine">{translate('no_flags', lang)}</li>}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------------------------- report */
export function ReportTab({
  manifest: m = {},
  reviewed,
  approved,
  flagged = 0,
  rejected = 0,
  total,
  sceneId,
  groundTruthResult,
  referenceSource,
  referenceError,
  onLoadReferenceFile,
  onLoadSampleReference,
  onClearReference,
  hasSampleReference,
  lang = 'en',
}) {
  const t = m.timings_s
  const geo = m.georef_source === 'assumed_demo'
  const fileInputRef = useRef(null)

  return (
    <div className="report">
      <section>
        <h3>{translate('scene_section', lang)}</h3>
        <dl className="facts">
          <div><dt>{translate('size', lang)}</dt><dd>{m.size_px ? `${m.size_px[0]} × ${m.size_px[1]} px` : '—'}</dd></div>
          <div><dt>{translate('ground_res', lang)}</dt><dd>{m.gsd_m != null ? `${m.gsd_m} m/px` : '—'}</dd></div>
          <div><dt>{translate('area', lang)}</dt><dd>{m.area_ha != null ? `${fmt(m.area_ha, 2)} ha` : '—'}</dd></div>
          <div><dt>{translate('crs', lang)}</dt><dd>{m.crs || '—'}</dd></div>
        </dl>
        {geo && <p className="callout">{translate('assumed_callout', lang)}</p>}
      </section>

      <section>
        <h3>{translate('pipeline_produced', lang)}</h3>
        <dl className="facts">
          <div><dt>{translate('model', lang)}</dt><dd>{m.model || 'MobileSAM'}</dd></div>
          <div>
            <dt>{translate('classifier', lang)}</dt>
            <dd>
              {m.classifier
                ? translate('classifier_trained', lang, { count: m.classifier.n_labels, scenes: m.classifier.scenes ? m.classifier.scenes.join(', ') : 'unknown' })
                : translate('classifier_rule_based', lang)}
            </dd>
          </div>
          <div><dt>{translate('segments_proposed', lang)}</dt><dd>{m.counts?.sam_instances ?? '—'}</dd></div>
          <div><dt>{translate('building_footprints', lang)}</dt><dd>{m.counts?.buildings ?? '—'}</dd></div>
          <div><dt>{translate('candidate_parcels', lang)}</dt><dd>{m.counts?.parcels ?? '—'}</dd></div>
          <div><dt>{translate('road_corridors', lang)}</dt><dd>{m.counts?.road_corridors ?? '—'}</dd></div>
          <div>
            <dt>{translate('ground_covered_by', lang)}</dt>
            <dd>
              {m.coverage
                ? translate('coverage_breakdown', lang, { roofs: m.coverage.building_pct, lanes: m.coverage.road_pct, trees: m.coverage.vegetation_pct })
                : '—'}
            </dd>
          </div>
        </dl>
        {m.classifier && (
          <p className="fine">{translate('classifier_scope_note', lang)}</p>
        )}
      </section>

      {t && (
        <section>
          <h3>{translate('measured_runtime', lang)}</h3>
          <dl className="facts">
            <div><dt>{translate('segmentation', lang)}</dt><dd>{fmt(t.segmentation_s)} s on 1 CPU core</dd></div>
            <div><dt>{translate('everything_after', lang)}</dt><dd>{fmt(t.classification_s + t.vectorisation_s + t.parcel_inference_s + t.topology_s, 1)} s</dd></div>
          </dl>
          <p className="fine">{translate('segmentation_time_note', lang)}</p>
        </section>
      )}

      {/* Ground-truth Check Section */}
      <section className="gt-section">
        <div className="section-head-with-action">
          <h3>{translate('ground_truth_check', lang)}</h3>
          {groundTruthResult && (
            <button
              type="button"
              className="btn btn-sm btn-clear-gt"
              onClick={onClearReference}
              title={translate('clear_reference_title', lang)}
            >
              {translate('clear_reference', lang)}
            </button>
          )}
        </div>

        {!groundTruthResult ? (
          <div className="gt-unverified">
            <p className="callout">
              {translate('no_ref_callout', lang)}
            </p>

            <div className="gt-loader-box">
              <input
                ref={fileInputRef}
                type="file"
                accept=".geojson,.json,application/geo+json,application/json"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    onLoadReferenceFile(e.target.files[0])
                    e.target.value = ''
                  }
                }}
              />
              <button
                type="button"
                className="btn gt-upload-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
                </svg>
                {translate('upload_ref_geojson', lang)}
              </button>

              {hasSampleReference && (
                <div className="sample-gt-wrap">
                  <button
                    type="button"
                    className="btn primary gt-sample-btn"
                    onClick={onLoadSampleReference}
                  >
                    {translate('load_sample_ref', lang)}
                  </button>
                  <p className="fine">{translate('sample_ref_desc', lang, { sceneId })}</p>
                </div>
              )}
            </div>

            {referenceError && (
              <div className="callout danger gt-error">
                <p><b>Error loading reference:</b> {referenceError}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="gt-results">
            <div className="gt-source-card">
              <span className="gt-status-dot verified" aria-hidden="true" />
              <div className="gt-source-info">
                <span className="gt-source-title">{translate('ref_layer_active', lang)}</span>
                <span className="gt-source-desc">
                  {referenceSource?.name || translate('custom_reference', lang)} ({referenceSource?.count || groundTruthResult.summary.n_gt} {translate('survey_buildings', lang)})
                </span>
              </div>
            </div>

            {/* Test Conditions Card */}
            <div className="gt-conditions-card">
              <h4>{translate('test_conditions', lang)}</h4>
              <dl className="facts compact">
                <div><dt>Scene ID</dt><dd><code>{sceneId}</code></dd></div>
                <div><dt>{translate('ref_buildings_count', lang)}</dt><dd>{groundTruthResult.summary.n_gt}</dd></div>
                <div><dt>{translate('cand_buildings_count', lang)}</dt><dd>{groundTruthResult.summary.n_pred}</dd></div>
                <div><dt>{translate('iou_threshold', lang)}</dt><dd>≥ 0.50</dd></div>
                <div><dt>{translate('offset_step', lang)}</dt><dd>0.5 m</dd></div>
              </dl>
            </div>

            {/* Metrics Scorecard Grid */}
            <div className="gt-scorecard-grid">
              <div className="gt-metric-card">
                <span className="gt-metric-label">{translate('precision', lang)}</span>
                <span className="gt-metric-val">{(groundTruthResult.summary.precision * 100).toFixed(1)}%</span>
                <span className="gt-metric-sub">{translate('precision_sub', lang, { tp: groundTruthResult.summary.tp, total: groundTruthResult.summary.n_pred })}</span>
              </div>
              <div className="gt-metric-card">
                <span className="gt-metric-label">{translate('recall', lang)}</span>
                <span className="gt-metric-val">{(groundTruthResult.summary.recall * 100).toFixed(1)}%</span>
                <span className="gt-metric-sub">{translate('recall_sub', lang, { tp: groundTruthResult.summary.tp, total: groundTruthResult.summary.n_gt })}</span>
              </div>
              <div className="gt-metric-card highlight">
                <span className="gt-metric-label">{translate('f1_score', lang)}</span>
                <span className="gt-metric-val">{(groundTruthResult.summary.f1 * 100).toFixed(1)}%</span>
                <span className="gt-metric-sub">{translate('f1_sub', lang)}</span>
              </div>
              <div className="gt-metric-card">
                <span className="gt-metric-label">{translate('mean_matched_iou', lang)}</span>
                <span className="gt-metric-val">{(groundTruthResult.summary.mean_matched_iou * 100).toFixed(1)}%</span>
                <span className="gt-metric-sub">{translate('mean_matched_sub', lang, { tp: groundTruthResult.summary.tp })}</span>
              </div>
            </div>

            {/* Boundary Offset Card */}
            <div className="gt-offset-card">
              <h4>{translate('boundary_offset_title', lang)}</h4>
              <dl className="facts compact">
                <div><dt>{translate('mean_offset', lang)}</dt><dd><b>{groundTruthResult.summary.boundary_offset.mean_m} m</b></dd></div>
                <div><dt>{translate('median_offset', lang)}</dt><dd>{groundTruthResult.summary.boundary_offset.median_m} m</dd></div>
                <div><dt>{translate('p90_offset', lang)}</dt><dd><b>{groundTruthResult.summary.boundary_offset.p90_m} m</b></dd></div>
                <div><dt>{translate('rmse_offset', lang)}</dt><dd>{groundTruthResult.summary.boundary_offset.rmse_m} m</dd></div>
              </dl>
              <p className="fine">{translate('offset_explanation', lang)}</p>
            </div>

            {/* Footprint Classification Breakdown */}
            <div className="gt-breakdown-card">
              <h4>{translate('footprint_classification', lang)}</h4>
              <ul className="gt-breakdown-list">
                <li className="gt-breakdown-item tp">
                  <span className="gt-chip tp">TP</span>
                  <div className="gt-breakdown-text">
                    <b>{groundTruthResult.summary.tp} {translate('matched_buildings', lang)}</b>
                    <span>{translate('matched_buildings_desc', lang)}</span>
                  </div>
                </li>
                <li className="gt-breakdown-item fp">
                  <span className="gt-chip fp">FP</span>
                  <div className="gt-breakdown-text">
                    <b>{groundTruthResult.summary.fp} {translate('fp_buildings', lang)}</b>
                    <span>{translate('fp_buildings_desc', lang)}</span>
                  </div>
                </li>
                <li className="gt-breakdown-item fn">
                  <span className="gt-chip fn">FN</span>
                  <div className="gt-breakdown-text">
                    <b>{groundTruthResult.summary.fn} {translate('fn_buildings', lang)}</b>
                    <span>{translate('fn_buildings_desc', lang)}</span>
                  </div>
                </li>
              </ul>
            </div>

            <p className="fine">{translate('gt_calc_note', lang)}</p>
          </div>
        )}
      </section>

      <section>
        <h3>{translate('reviewed_progress', lang)}</h3>
        <dl className="facts">
          <div><dt>{translate('kpi_reviewed', lang)}</dt><dd>{reviewed} {translate('step_progress_of', lang)} {total}</dd></div>
          <div><dt>{translate('status_approved', lang)}</dt><dd>{approved}</dd></div>
          <div><dt>{translate('status_flagged', lang)}</dt><dd>{flagged}</dd></div>
          <div><dt>{translate('status_rejected', lang)}</dt><dd>{rejected}</dd></div>
        </dl>
        <p className="fine">{m.status_note}</p>
      </section>
    </div>
  )
}

export default function RightPanel(props) {
  const { tab, onTab, lang = 'en', onClose } = props
  const tabs = [
    ['parcel', translate('tab_parcel', lang)],
    ['checks', translate('tab_checks', lang)],
    ['report', translate('tab_report', lang)],
  ]
  return (
    <aside className="side" aria-label="Details">
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => onTab(k)}
          >
            {l}
          </button>
        ))}
        {onClose && (
          <button
            type="button"
            className="drawer-close-btn side-drawer-close"
            onClick={onClose}
            aria-label="Close inspector drawer"
            title="Close drawer"
          >
            ✕
          </button>
        )}
      </div>
      <div className="side-body">
        {tab === 'parcel' && <ParcelTab {...props} />}
        {tab === 'checks' && <ChecksTab {...props} />}
        {tab === 'report' && <ReportTab {...props} />}
      </div>
    </aside>
  )
}
