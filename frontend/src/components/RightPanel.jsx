import { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react'
import { STATUS, ISSUE_LABEL } from '../lib/steps.js'
import { areaM2, boundsOf } from '../lib/geo.js'

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

function Pill({ status }) {
  const s = STATUS[status] || STATUS.draft
  return <span className="pill" style={{ '--c': s.color }}>{s.label}</span>
}

function StatusIcon({ status }) {
  const st = status || 'draft'
  if (st === 'approved') {
    return (
      <span className="queue-status-icon approved" title="Approved" aria-label="Approved">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
        </svg>
      </span>
    )
  }
  if (st === 'flagged') {
    return (
      <span className="queue-status-icon flagged" title="Needs field check" aria-label="Needs field check">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />
        </svg>
      </span>
    )
  }
  if (st === 'rejected') {
    return (
      <span className="queue-status-icon rejected" title="Rejected" aria-label="Rejected">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </span>
    )
  }
  return <span className="queue-status-icon draft" title="Draft / Unverified" aria-label="Draft" />
}

/* ------------------------------------------------------------------------------------- parcel queue item */
function QueueRow({ feature, isSelected, statusObj, onSelect, onFocus }) {
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
      <StatusIcon status={st} />
      <div className="queue-item-main">
        <div className="queue-item-title">
          <span className="queue-item-id">Plot {shortId}</span>
          <span className={`queue-prio-tag ${prio.toLowerCase()}`}>{prio}</span>
        </div>
        <div className="queue-item-meta">
          <span>{fmt(area, 0)} m²</span>
          <span className="dot-sep">·</span>
          <span>{p.landuse || 'Built-up'}</span>
        </div>
      </div>
      {statusObj?.decided_by === 'bulk' && (
        <span className="badge-bulk" title="Approved in bulk">bulk</span>
      )}
    </button>
  )
}

/* ------------------------------------------------------------------------------------- shortcuts footer */
function ShortcutsFooter() {
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
    <footer className="shortcuts-footer" aria-label="Keyboard shortcuts guide">
      <button
        type="button"
        className="shortcuts-toggle-btn"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="shortcuts-toggle-left">
          <kbd className="key-cap">?</kbd>
          <span className="shortcuts-heading">Keyboard shortcuts</span>
        </span>
        <span className="shortcuts-toggle-arrow">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="shortcuts-grid">
          <div className="shortcut-cell"><kbd className="key-cap">A</kbd> <span>approve</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">F</kbd> <span>field check</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">R</kbd> <span>reject</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">N</kbd> <span>next plot</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">E</kbd> <span>edit boundary</span></div>
          <div className="shortcut-cell"><kbd className="key-cap">Esc</kbd> <span>deselect</span></div>
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
            <span>Approved <b>{bulkUndoState.count}</b> Low priority parcels in bulk.</span>
          </div>
          <button type="button" className="btn btn-sm btn-undo" onClick={onUndoBulk}>
            Undo bulk approve
          </button>
        </div>
      )}

      {/* Selected Parcel Inspector OR 1-line hint */}
      {parcel ? (
        <div className="parcel-inspector">
          <header className="parcel-head">
            <div>
              <div className="parcel-title-wrap">
                <h2>Plot {p.parcel_id.slice(-4)}</h2>
                <button type="button" className="btn-close-parcel" onClick={() => onSelect(null)} title="Deselect (Esc)">
                  ✕
                </button>
              </div>
              <p className="fine">{p.parcel_id}</p>
            </div>
            <Pill status={st.status} />
          </header>

          <dl className="facts">
            <div><dt>Area</dt><dd>{fmt(areaM2(parcel), 1)} m²</dd></div>
            <div><dt>Building coverage</dt><dd>{Math.round(p.building_coverage * 100)}%</dd></div>
            <div><dt>Vegetation share</dt><dd>{Math.round(p.vegetation_share * 100)}%</dd></div>
            <div><dt>Land use (rule-based)</dt><dd>{p.landuse}</dd></div>
            <div><dt>Review priority</dt><dd className={`prio ${p.review_priority.toLowerCase()}`}>{p.review_priority}</dd></div>
            {p.review_reasons && <div><dt>Why this needs a look</dt><dd className="review-reason-text">{p.review_reasons}</dd></div>}
            <div><dt>Segment quality</dt><dd>{fmt(p.sam_quality, 2)}</dd></div>
          </dl>
          <p className="fine">Segment quality is the model's own stability estimate for the building outline, not a measured accuracy. Priority is from class evidence and topology flags.</p>

          {mine.length > 0 && (
            <section>
              <h3>Flags on this plot</h3>
              <ul className="flag-list">
                {mine.map((i) => (
                  <li key={i.properties.issue_id}><b>{ISSUE_LABEL[i.properties.type]}.</b> {i.properties.fix}</li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="section-head-with-action">
              <h3>Boundary</h3>
              {!editing && (
                <button type="button" className="btn btn-sm" onClick={onEditStart}>
                  Edit boundary <kbd>E</kbd>
                </button>
              )}
            </div>
            {editing && (
              <div className="edit-box">
                <p>Drag a corner, or click the midpoint of an edge to add one. Press <kbd>Esc</kbd> to exit.</p>
                {overlaps.length === 0 ? (
                  <p className="ok-line">No overlap with neighbouring plots.</p>
                ) : (
                  <div className="warn-line">
                    <p><b>Overlap:</b> {overlaps.map((o) => `${o.with.slice(-4)} by ${fmt(o.area, 1)} m²`).join(', ')}</p>
                    <button type="button" className="btn" onClick={onResolve}>Resolve: this plot gives up the overlap</button>
                  </div>
                )}
                <button type="button" className="btn primary" onClick={onEditDone}>Done editing</button>
              </div>
            )}
          </section>

          <section>
            <h3>Decision</h3>
            <label className="field">
              <span>Note (optional)</span>
              <textarea
                rows="2"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. boundary wall visible on the east side"
              />
            </label>
            <div className="decide">
              <button type="button" className="btn ok" onClick={() => decide('approved')}>
                Approve <kbd>A</kbd>
              </button>
              <button type="button" className="btn warn" onClick={() => decide('flagged')}>
                Needs field check <kbd>F</kbd>
              </button>
              <button type="button" className="btn bad" onClick={() => decide('rejected')}>
                Reject <kbd>R</kbd>
              </button>
            </div>
            {st.note && (
              <p className="fine">
                Last note: {st.note} {st.decided_by && <span className="provenance-tag">({st.decided_by})</span>}
              </p>
            )}
          </section>

          {log.length > 0 && (
            <section>
              <h3>History</h3>
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
          <p className="lead">Select a parcel on the map.</p>
        </div>
      )}

      {/* Review Queue Section */}
      <div className="queue-section">
        <div className="queue-head">
          <div>
            <h3>Review Queue</h3>
            <p className="fine">{unreviewedCount} of {total} unreviewed</p>
          </div>
          <div className="queue-actions">
            <button
              type="button"
              className="btn btn-sm next-btn"
              onClick={onNextInQueue}
              title="Jump to next unreviewed parcel (N)"
            >
              Next <kbd>N</kbd>
            </button>
            <button
              type="button"
              className="btn btn-sm bulk-btn"
              onClick={onBulkApproveOpen}
              disabled={lowDraftCount === 0}
              title="Bulk approve all Low priority draft parcels"
            >
              Approve Low ({lowDraftCount})
            </button>
          </div>
        </div>

        <div
          className="queue-list"
          tabIndex={0}
          role="region"
          aria-label="Parcel review queue"
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
              />
            )
          })}
        </div>
      </div>

      {/* Collapsible Keyboard Shortcuts Footer */}
      <ShortcutsFooter />
    </div>
  )
}

/* ------------------------------------------------------------------------------------- checks */
function ChecksTab({ manifest, issues, fixMode, onFocus }) {
  const topo = manifest.topology
  const types = useMemo(() => [...new Set([...Object.keys(topo.before_fix), ...Object.keys(topo.after_fix)])], [topo])
  const sevRank = { error: 0, warning: 1, info: 2 }
  const sorted = [...issues].sort((a, b) => sevRank[a.properties.severity] - sevRank[b.properties.severity])
  return (
    <div className="checks">
      <table className="tbl">
        <thead><tr><th>Rule</th><th>Before</th><th>After</th></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t}><td>{ISSUE_LABEL[t] || t}</td><td>{topo.before_fix[t] || 0}</td><td>{topo.after_fix[t] || 0}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="fine">Showing {fixMode === 'before' ? 'before' : 'after'} auto-fix. Rules are exact geometry tests (Shapely); a thin ribbon under 35 cm counts as digitising noise, not an error.</p>
      <ul className="issue-list">
        {sorted.map((i) => (
          <li key={i.properties.issue_id}>
            <button onClick={() => onFocus(boundsOf(i))}>
              <span className={`dot ${i.properties.severity}`} aria-hidden="true" />
              <span>
                <b>{ISSUE_LABEL[i.properties.type]}</b>
                <span className="msg">{i.properties.message}</span>
              </span>
            </button>
          </li>
        ))}
        {sorted.length === 0 && <li className="fine">No flags.</li>}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------------------------- report */
function ReportTab({ manifest: m, reviewed, approved, flagged = 0, rejected = 0, total }) {
  const t = m.timings_s
  const geo = m.georef_source === 'assumed_demo'
  return (
    <div className="report">
      <section>
        <h3>Scene</h3>
        <dl className="facts">
          <div><dt>Size</dt><dd>{m.size_px[0]} × {m.size_px[1]} px</dd></div>
          <div><dt>Ground resolution</dt><dd>{m.gsd_m} m/px</dd></div>
          <div><dt>Area</dt><dd>{fmt(m.area_ha, 2)} ha</dd></div>
          <div><dt>CRS</dt><dd>{m.crs}</dd></div>
        </dl>
        {geo && <p className="callout">Georeference is assumed for this demo image (no survey metadata). A real orthomosaic GeoTIFF brings its own CRS and transform.</p>}
      </section>
      <section>
        <h3>What the pipeline produced</h3>
        <dl className="facts">
          <div><dt>Model</dt><dd>{m.model}</dd></div>
          <div><dt>Segments proposed</dt><dd>{m.counts.sam_instances}</dd></div>
          <div><dt>Building footprints</dt><dd>{m.counts.buildings}</dd></div>
          <div><dt>Candidate parcels</dt><dd>{m.counts.parcels}</dd></div>
          <div><dt>Road corridors</dt><dd>{m.counts.road_corridors}</dd></div>
          <div><dt>Ground covered by</dt><dd>{m.coverage.building_pct}% roofs, {m.coverage.road_pct}% lanes, {m.coverage.vegetation_pct}% trees</dd></div>
        </dl>
      </section>
      <section>
        <h3>Measured run time</h3>
        <dl className="facts">
          <div><dt>Segmentation</dt><dd>{fmt(t.segmentation_s)} s on 1 CPU core</dd></div>
          <div><dt>Everything after</dt><dd>{fmt(t.classification_s + t.vectorisation_s + t.parcel_inference_s + t.topology_s, 1)} s</dd></div>
        </dl>
        <p className="fine">Segmentation time is from the run that produced the cached masks; a GPU is far faster.</p>
      </section>
      <section>
        <h3>Ground-truth check</h3>
        <p className="callout">No reference polygons were supplied for this scene, so no accuracy figure is shown. IoU, F1 and boundary offset will be computed here once survey data is loaded.</p>
      </section>
      <section>
        <h3>Review</h3>
        <dl className="facts">
          <div><dt>Reviewed</dt><dd>{reviewed} of {total}</dd></div>
          <div><dt>Approved</dt><dd>{approved}</dd></div>
          <div><dt>Needs field check</dt><dd>{flagged}</dd></div>
          <div><dt>Rejected</dt><dd>{rejected}</dd></div>
        </dl>
        <p className="fine">{m.status_note}</p>
      </section>
    </div>
  )
}

export default function RightPanel(props) {
  const { tab, onTab } = props
  const tabs = [['parcel', 'Parcel'], ['checks', 'Checks'], ['report', 'Report']]
  return (
    <aside className="side" aria-label="Details">
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{l}</button>
        ))}
      </div>
      <div className="side-body">
        {tab === 'parcel' && <ParcelTab {...props} />}
        {tab === 'checks' && <ChecksTab {...props} />}
        {tab === 'report' && <ReportTab {...props} />}
      </div>
    </aside>
  )
}
