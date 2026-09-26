import { useState } from 'react'
import { STATUS, LANDUSE_TINT } from '../lib/steps.js'
import { translate } from '../lib/i18n.js'

export default function Legend({ vis, styleMode, fillEnabled, lang = 'en' }) {
  const [collapsed, setCollapsed] = useState(false)

  const classMasks = [
    { label: translate('class_building', lang), color: '#E2566B' },
    { label: translate('class_road', lang), color: '#2563C9' },
    { label: translate('class_vegetation', lang), color: '#2F8F55' },
    { label: translate('class_open_ground', lang), color: '#D4A373' },
  ]

  const topoColors = [
    { label: translate('topo_error', lang), color: '#D62839' },
    { label: translate('topo_warning', lang), color: '#E8A317' },
    { label: translate('topo_info', lang), color: '#4C6EF5' },
  ]

  function getStatusLabel(k) {
    if (k === 'approved') return translate('status_approved', lang)
    if (k === 'flagged') return translate('status_flagged', lang)
    if (k === 'rejected') return translate('status_rejected', lang)
    return translate('status_draft', lang)
  }

  function getLanduseLabel(lu) {
    if (!lu) return '—'
    const lower = String(lu).toLowerCase()
    if (lower.includes('low')) return translate('landuse_builtup_low', lang)
    if (lower.includes('built')) return translate('landuse_builtup', lang)
    if (lower.includes('veg')) return translate('landuse_veg', lang)
    if (lower.includes('vacant') || lower.includes('open')) return translate('landuse_vacant', lang)
    return lu
  }

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
    <div className={`map-legend ${collapsed ? 'is-collapsed' : ''}`} aria-label={translate('legend', lang)}>
      <div className="legend-head" onClick={() => setCollapsed(!collapsed)} role="button" tabIndex={0}>
        <b>{translate('legend', lang)}</b>
        <button className="legend-toggle-btn" aria-label={collapsed ? 'Expand legend' : 'Collapse legend'}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>

      {!collapsed && (
        <div className="legend-body">
          {showMasks && (
            <div className="legend-sec">
              <span className="legend-sec-title">{translate('class_masks', lang)}</span>
              <ul>
                {classMasks.map((c) => (
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
                {styleMode === 'status'
                  ? translate('parcel_review_status', lang)
                  : fillEnabled
                  ? translate('landuse_rule_based', lang)
                  : translate('layer_parcels', lang)}
              </span>
              <ul>
                {styleMode === 'status' ? (
                  Object.entries(STATUS).map(([k, v]) => (
                    <li key={k}>
                      <i style={{ background: v.color }} />
                      <span>{getStatusLabel(k)}</span>
                    </li>
                  ))
                ) : fillEnabled ? (
                  Object.entries(LANDUSE_TINT).map(([k, color]) => (
                    <li key={k}>
                      <i style={{ background: color }} />
                      <span>{getLanduseLabel(k)}</span>
                    </li>
                  ))
                ) : (
                  <li>
                    <i style={{ background: 'transparent', border: '2px solid #C8402B' }} />
                    <span>{translate('candidate_boundary', lang)}</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {showIssues && (
            <div className="legend-sec">
              <span className="legend-sec-title">{translate('topology_flags', lang)}</span>
              <ul>
                {topoColors.map((t) => (
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
                  <span>{translate('layer_buildings', lang)}</span>
                </li>
              </ul>
            </div>
          )}

          {showRoads && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: '#2563C9' }} />
                  <span>{translate('layer_roads', lang)}</span>
                </li>
              </ul>
            </div>
          )}

          {showVeg && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: '#2F8F55' }} />
                  <span>{translate('layer_vegetation', lang)}</span>
                </li>
              </ul>
            </div>
          )}

          {showSegments && (
            <div className="legend-sec">
              <ul>
                <li>
                  <i style={{ background: 'linear-gradient(135deg, #FF6B6B, #4ECDC4, #FFE66D)' }} />
                  <span>{translate('sam_proposals', lang)}</span>
                </li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
