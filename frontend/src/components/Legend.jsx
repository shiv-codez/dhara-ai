import { useState } from 'react'
import { STATUS, LANDUSE_TINT, ISSUE_LABEL } from '../lib/steps.js'

const CLASS_MASKS = [
  { label: 'Building', color: '#E2566B' },
  { label: 'Road corridor', color: '#2563C9' },
  { label: 'Vegetation', color: '#2F8F55' },
  { label: 'Open ground', color: '#D4A373' },
]

const TOPO_COLORS = [
  { label: 'Error', color: '#D62839' },
  { label: 'Warning', color: '#E8A317' },
  { label: 'Info', color: '#4C6EF5' },
]

export default function Legend({ vis, styleMode, fillEnabled }) {
  const [collapsed, setCollapsed] = useState(false)

  // Determine which sections are active
  const showMasks = !!vis.masks
  const showParcels = !!vis.parcels
  const showBuildings = (vis.buildings || vis.buildingsRaw) && !vis.masks
  const showRoads = !!vis.roads && !vis.masks
  const showVeg = !!vis.vegetation && !vis.masks
  const showIssues = !!vis.issues
  const showSegments = !!vis.segments && !vis.masks

  const hasAny = showMasks || showParcels || showBuildings || showRoads || showVeg || showIssues || showSegments
  if (!hasAny) return null

  return (
    <div className={`map-legend ${collapsed ? 'is-collapsed' : ''}`} aria-label="Map legend">
      <div className="legend-head" onClick={() => setCollapsed(!collapsed)} role="button" tabIndex={0}>
        <b>Legend</b>
        <button className="legend-toggle-btn" aria-label={collapsed ? 'Expand legend' : 'Collapse legend'}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div className="legend-body">
          {showMasks && (
            <div className="legend-sec">
              <span className="legend-sec-title">Class masks</span>
              <ul>
                {CLASS_MASKS.map((c) => (
                  <li key={c.label}>
                    <i style={{ background: c.color }} />
                    <span>{c.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showParcels && (
            <div className="legend-sec">
              <span className="legend-sec-title">
                {styleMode === 'status' ? 'Parcel review status' : fillEnabled ? 'Land use (rule-based)' : 'Parcels'}
              </span>
              <ul>
                {styleMode === 'status' ? (
                  Object.entries(STATUS).map(([k, v]) => (
                    <li key={k}>
                      <i style={{ background: v.color }} />
                      <span>{v.label}</span>
                    </li>
                  ))
                ) : fillEnabled ? (
                  Object.entries(LANDUSE_TINT).map(([k, color]) => (
                    <li key={k}>
                      <i style={{ background: color }} />
                      <span>{k}</span>
                    </li>
                  ))
                ) : (
                  <li>
                    <i style={{ background: 'transparent', border: '2px solid #C8402B' }} />
                    <span>Candidate boundary</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {showIssues && (
            <div className="legend-sec">
              <span className="legend-sec-title">Topology flags</span>
              <ul>
                {TOPO_COLORS.map((t) => (
                  <li key={t.label}>
                    <i style={{ background: t.color, borderRadius: '50%' }} />
                    <span>{t.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showBuildings && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: '#E2566B', border: '1px solid #C8402B' }} />
                  <span>Building footprints</span>
                </li>
              </ul>
            </div>
          )}

          {showRoads && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: '#2563C9' }} />
                  <span>Road corridors</span>
                </li>
              </ul>
            </div>
          )}

          {showVeg && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: '#2F8F55' }} />
                  <span>Vegetation</span>
                </li>
              </ul>
            </div>
          )}

          {showSegments && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: 'linear-gradient(135deg, #FF6B6B, #4ECDC4, #FFE66D)' }} />
                  <span>SAM instance proposals</span>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
