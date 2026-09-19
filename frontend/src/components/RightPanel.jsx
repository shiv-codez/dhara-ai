import { useMemo, useState } from 'react'
import { STATUS, ISSUE_LABEL } from '../lib/steps.js'
import { areaM2, boundsOf } from '../lib/geo.js'

const fmt = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })

function Pill({ status }) {
  const s = STATUS[status] || STATUS.draft
  return <span className="pill" style={{ '--c': s.color }}>{s.label}</span>
}

/* ------------------------------------------------------------------------------------- parcel */
function ParcelTab({ parcel, statuses, onStatus, audit, issues, editing, onEditStart, onEditDone, overlaps, onResolve, reviewed, total }) {
  const [note, setNote] = useState('')
  if (!parcel) {
    return (
      <div className="pane-empty">
        <p className="lead">Select a parcel on the map.</p>
        <p>You will see what the pipeline knows about it, and can edit its boundary and record a decision.</p>
        <div className="progress" aria-label="Review progress">
          <div className="bar"><span style={{ width: `${(reviewed / Math.max(total, 1)) * 100}%` }} /></div>
          <p className="fine">{reviewed} of {total} parcels reviewed</p>
        </div>
      </div>
    )
  }
  const p = parcel.properties
  const st = statuses[p.parcel_id] || { status: 'draft' }
  const mine = issues.filter((i) => i.properties.parcel_ids?.split(',').includes(p.parcel_id))
  const log = audit.filter((a) => a.parcel === p.parcel_id).slice(-4).reverse()
  const decide = (status) => { onStatus(p.parcel_id, status, note); setNote('') }
  return (
    <div className="parcel">
      <header className="parcel-head">
        <div>
          <h2>Plot {p.parcel_id.slice(-4)}</h2>
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
        <div><dt>Segment quality</dt><dd>{fmt(p.sam_quality, 2)}</dd></div>
      </dl>
      <p className="fine">Segment quality is the model's own stability estimate for the building outline. It is not a measured accuracy.</p>

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
        <h3>Boundary</h3>
        {!editing ? (
          <button className="btn" onClick={onEditStart}>Edit boundary</button>
        ) : (
          <div className="edit-box">
            <p>Drag a corner, or click the midpoint of an edge to add one.</p>
            {overlaps.length === 0 ? (
              <p className="ok-line">No overlap with neighbouring plots.</p>
            ) : (
              <div className="warn-line">
                <p><b>Overlap:</b> {overlaps.map((o) => `${o.with.slice(-4)} by ${fmt(o.area, 1)} m²`).join(', ')}</p>
                <button className="btn" onClick={onResolve}>Resolve: this plot gives up the overlap</button>
              </div>
            )}
            <button className="btn primary" onClick={onEditDone}>Done editing</button>
          </div>
        )}
      </section>

      <section>
        <h3>Decision</h3>
        <label className="field">
          <span>Note (optional)</span>
          <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. boundary wall visible on the east side" />
        </label>
        <div className="decide">
          <button className="btn ok" onClick={() => decide('approved')}>Approve</button>
          <button className="btn warn" onClick={() => decide('flagged')}>Needs field check</button>
          <button className="btn bad" onClick={() => decide('rejected')}>Reject</button>
        </div>
        {st.note && <p className="fine">Last note: {st.note}</p>}
      </section>

      {log.length > 0 && (
        <section>
          <h3>History</h3>
          <ul className="log">
            {log.map((a, i) => (
              <li key={i}><time>{new Date(a.t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</time> {a.text}</li>
            ))}
          </ul>
        </section>
      )}
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
function ReportTab({ manifest: m, reviewed, approved, total }) {
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
