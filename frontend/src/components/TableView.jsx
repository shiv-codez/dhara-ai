import React, { useState, useMemo } from 'react'
import { translate } from '../lib/i18n'
import { STATUS, LANDUSE_TINT } from '../lib/steps'

export default function TableView({
  parcelsGeoJSON,
  statuses = {},
  selectedId,
  selectedFeature,
  onSelectParcel,
  onDecide,
  lang = 'en',
  onSwitchToMap,
}) {
  const [sortField, setSortField] = useState('plot_id')
  const [sortDirection, setSortDirection] = useState('asc')
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterPriority, setFilterPriority] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  const features = useMemo(() => {
    if (!parcelsGeoJSON || !Array.isArray(parcelsGeoJSON.features)) return []
    return parcelsGeoJSON.features
  }, [parcelsGeoJSON])

  const getParcelStatus = (p) => {
    const id = p?.parcel_id || p?.id
    if (statuses && statuses[id]?.status) {
      return statuses[id].status.toLowerCase()
    }
    return (p?.review_status || 'draft').toLowerCase()
  }

  const getParcelPrio = (p) => {
    return (p?.review_priority || p?.priority || 'Low').toUpperCase()
  }

  const getParcelLanduse = (p) => {
    return p?.landuse || p?.landuse_class || 'Built-up'
  }

  const getParcelId = (p) => {
    return p?.parcel_id || p?.plot_code || p?.id || ''
  }

  // Summary KPI stats
  const kpis = useMemo(() => {
    let totalArea = 0
    let approved = 0
    let flagged = 0
    let rejected = 0
    let draft = 0

    features.forEach((f) => {
      const p = f.properties || {}
      totalArea += Number(p.area_m2) || 0
      const s = getParcelStatus(p)
      if (s === 'approved') approved++
      else if (s === 'flagged' || s === 'needs_field_check') flagged++
      else if (s === 'rejected') rejected++
      else draft++
    })

    const total = features.length
    const reviewed = approved + flagged + rejected
    const reviewedPct = total > 0 ? Math.round((reviewed / total) * 100) : 0

    return {
      total,
      totalArea: Math.round(totalArea),
      totalAreaHa: (totalArea / 10000).toFixed(2),
      reviewed,
      reviewedPct,
      approved,
      flagged,
      rejected,
      draft,
    }
  }, [features, statuses])

  // Area distribution histogram bins
  const histogram = useMemo(() => {
    if (features.length === 0) return []
    const bins = [
      { label: '< 100 m²', min: 0, max: 100, count: 0 },
      { label: '100 – 250 m²', min: 100, max: 250, count: 0 },
      { label: '250 – 500 m²', min: 250, max: 500, count: 0 },
      { label: '500 – 1000 m²', min: 500, max: 1000, count: 0 },
      { label: '> 1000 m²', min: 1000, max: Infinity, count: 0 },
    ]

    features.forEach((f) => {
      const area = Number(f.properties?.area_m2) || 0
      for (const bin of bins) {
        if (area >= bin.min && area < bin.max) {
          bin.count++
          break
        }
      }
    })

    const maxCount = Math.max(...bins.map((b) => b.count), 1)
    return bins.map((b) => ({
      ...b,
      pctOfTotal: features.length > 0 ? Math.round((b.count / features.length) * 100) : 0,
      barWidthPct: Math.round((b.count / maxCount) * 100),
    }))
  }, [features])

  // Priority weight for sorting
  const PRIORITY_ORDER = { HIGH: 3, MEDIUM: 2, LOW: 1 }

  // Filtered & Sorted parcel rows
  const sortedRows = useMemo(() => {
    let list = features.filter((f) => {
      const p = f.properties || {}
      const status = getParcelStatus(p).toUpperCase()
      const priority = getParcelPrio(p)

      if (filterStatus !== 'ALL') {
        if (filterStatus === 'DRAFT' && status !== 'DRAFT') return false
        if (filterStatus === 'APPROVED' && status !== 'APPROVED') return false
        if (filterStatus === 'NEEDS_FIELD_CHECK' && (status !== 'FLAGGED' && status !== 'NEEDS_FIELD_CHECK')) return false
        if (filterStatus === 'REJECTED' && status !== 'REJECTED') return false
      }

      if (filterPriority !== 'ALL') {
        if (priority !== filterPriority) return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const id = String(getParcelId(p)).toLowerCase()
        const code = String(p.plot_code ?? p.id_short ?? '').toLowerCase()
        if (!id.includes(q) && !code.includes(q)) return false
      }

      return true
    })

    list.sort((a, b) => {
      const pa = a.properties || {}
      const pb = b.properties || {}

      let valA = pa[sortField]
      let valB = pb[sortField]

      if (sortField === 'plot_id') {
        valA = String(getParcelId(pa))
        valB = String(getParcelId(pb))
      } else if (sortField === 'area_m2') {
        valA = Number(pa.area_m2) || 0
        valB = Number(pb.area_m2) || 0
      } else if (sortField === 'coverage') {
        valA = Number(pa.building_coverage) || 0
        valB = Number(pb.building_coverage) || 0
      } else if (sortField === 'priority') {
        valA = PRIORITY_ORDER[getParcelPrio(pa)] || 0
        valB = PRIORITY_ORDER[getParcelPrio(pb)] || 0
      } else if (sortField === 'status') {
        valA = getParcelStatus(pa)
        valB = getParcelStatus(pb)
      } else if (sortField === 'landuse') {
        valA = String(getParcelLanduse(pa))
        valB = String(getParcelLanduse(pb))
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [features, statuses, filterStatus, filterPriority, searchQuery, sortField, sortDirection])

  function toggleSort(field) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  function getPriorityLabel(prio) {
    const key = (prio || 'LOW').toUpperCase()
    if (key === 'HIGH') return translate('prio_high', lang)
    if (key === 'MEDIUM') return translate('prio_medium', lang)
    return translate('prio_low', lang)
  }

  function getStatusLabel(st) {
    const key = (st || 'draft').toLowerCase()
    if (key === 'approved') return translate('status_approved', lang)
    if (key === 'needs_field_check' || key === 'flagged') return translate('status_flagged', lang)
    if (key === 'rejected') return translate('status_rejected', lang)
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

  function handleRowSelect(feature) {
    const p = feature.properties || {}
    const id = p.parcel_id || p.id
    if (onSelectParcel) onSelectParcel(id || feature)
  }

  function handleInspect(feature, e) {
    e.stopPropagation()
    const p = feature.properties || {}
    const id = p.parcel_id || p.id
    if (onSelectParcel) onSelectParcel(id || feature, { inspect: true })
    if (onSwitchToMap) onSwitchToMap()
  }

  function handleQuickDecide(feature, status, e) {
    e.stopPropagation()
    const p = feature.properties || {}
    const id = p.parcel_id || p.id
    if (onDecide) onDecide(id, status)
  }

  const activeSelectedId = selectedId || selectedFeature?.properties?.parcel_id || selectedFeature?.properties?.id

  return (
    <div className="table-dashboard-container" role="region" aria-label={translate('view_table', lang)}>
      {/* Survey Ledger Metric Header: Unified Single Contiguous Overview Row */}
      <div className="ledger-overview-row" role="region" aria-label="Review overview">
        {/* Dominant Hero Metric Section */}
        <div className="ledger-hero-section">
          <div className="ledger-hero-header">
            <div className="ledger-hero-title">{translate('kpi_reviewed', lang)}</div>
            <div className="ledger-hero-area font-mono">
              {kpis.totalArea.toLocaleString()} m² ({kpis.totalAreaHa} ha)
            </div>
          </div>
          <div className="ledger-hero-body">
            <div className="ledger-hero-stat">
              <span className="ledger-hero-num font-mono">{kpis.reviewed}</span>
              <span className="ledger-hero-denom font-mono">/ {kpis.total}</span>
              <span className="ledger-hero-pct font-mono">({kpis.reviewedPct}%)</span>
            </div>
            <div className="ledger-hero-track" role="progressbar" aria-valuenow={kpis.reviewedPct} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="ledger-hero-fill"
                style={{ width: `${Math.max(kpis.reviewedPct, 2)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Hairline Divider between Hero and Status Chips */}
        <div className="ledger-chip-divider hero-divider" />

        {/* Inline Hairline-Separated Status Breakdown Section */}
        <div className="ledger-chips-section" role="group" aria-label="Review status breakdown">
          <div className="ledger-chip-item">
            <span className="ledger-chip-dot status-dot-approved" />
            <span className="ledger-chip-label">{translate('kpi_approved', lang)}</span>
            <span className="ledger-chip-val font-mono">{kpis.approved}</span>
          </div>
          <div className="ledger-chip-divider" />
          <div className="ledger-chip-item">
            <span className="ledger-chip-dot status-dot-flagged" />
            <span className="ledger-chip-label">{translate('kpi_flagged', lang)}</span>
            <span className="ledger-chip-val font-mono">{kpis.flagged}</span>
          </div>
          <div className="ledger-chip-divider" />
          <div className="ledger-chip-item">
            <span className="ledger-chip-dot status-dot-rejected" />
            <span className="ledger-chip-label">{translate('kpi_rejected', lang)}</span>
            <span className="ledger-chip-val font-mono">{kpis.rejected}</span>
          </div>
          <div className="ledger-chip-divider" />
          <div className="ledger-chip-item">
            <span className="ledger-chip-dot status-dot-draft" />
            <span className="ledger-chip-label">{translate('kpi_unreviewed', lang)}</span>
            <span className="ledger-chip-val font-mono">{kpis.draft}</span>
          </div>
          <div className="ledger-chip-divider" />
          <div className="ledger-chip-item">
            <span className="ledger-chip-label">{translate('kpi_total_parcels', lang)}</span>
            <span className="ledger-chip-val font-mono font-bold">{kpis.total}</span>
          </div>
        </div>
      </div>

      {/* Area Distribution Histogram */}
      <div className="histogram-card">
        <div className="histogram-header">
          <h3 className="histogram-title">{translate('histogram_title', lang)}</h3>
          <p className="histogram-subtitle">{translate('histogram_subtitle', lang)}</p>
        </div>
        <div className="histogram-bars">
          {histogram.map((bin, i) => (
            <div key={i} className="histogram-row">
              <div className="histogram-bin-label">{bin.label}</div>
              <div className="histogram-track" title={`${bin.count} parcels (${bin.pctOfTotal}%)`}>
                <div
                  className="histogram-fill"
                  style={{ width: `${Math.max(bin.barWidthPct, 2)}%` }}
                />
              </div>
              <div className="histogram-count font-mono">
                <strong>{bin.count}</strong> <span className="histogram-pct">({bin.pctOfTotal}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Table Controls / Filters */}
      <div className="table-controls">
        <div className="table-search-box">
          <span className="search-icon" aria-hidden="true">🔍</span>
          <input
            type="text"
            className="table-search-input"
            placeholder={translate('table_search_placeholder', lang)}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={translate('table_search_placeholder', lang)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="table-filter-group">
          <label className="table-filter-label">
            <span>{translate('filter_status', lang)}</span>
            <select
              className="table-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="ALL">{translate('all_statuses', lang)}</option>
              <option value="DRAFT">{translate('status_draft', lang)}</option>
              <option value="APPROVED">{translate('status_approved', lang)}</option>
              <option value="NEEDS_FIELD_CHECK">{translate('status_flagged', lang)}</option>
              <option value="REJECTED">{translate('status_rejected', lang)}</option>
            </select>
          </label>

          <label className="table-filter-label">
            <span>{translate('filter_priority', lang)}</span>
            <select
              className="table-select"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="ALL">{translate('all_priorities', lang)}</option>
              <option value="HIGH">{translate('prio_high', lang)}</option>
              <option value="MEDIUM">{translate('prio_medium', lang)}</option>
              <option value="LOW">{translate('prio_low', lang)}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="table-count-info">
        {translate('showing_parcels_count', lang, {
          filtered: sortedRows.length,
          total: features.length,
        })}
      </div>

      {/* Main Sortable Table */}
      <div className="table-scroll-wrap">
        <table className="parcel-table" role="table">
          <thead>
            <tr>
              <th
                className="sortable-th"
                onClick={() => toggleSort('plot_id')}
                aria-sort={sortField === 'plot_id' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_plot', lang)} {sortField === 'plot_id' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th
                className="sortable-th text-right"
                onClick={() => toggleSort('area_m2')}
                aria-sort={sortField === 'area_m2' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_area', lang)} {sortField === 'area_m2' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th
                className="sortable-th"
                onClick={() => toggleSort('landuse')}
                aria-sort={sortField === 'landuse' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_landuse', lang)} {sortField === 'landuse' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th
                className="sortable-th text-right"
                onClick={() => toggleSort('coverage')}
                aria-sort={sortField === 'coverage' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_coverage', lang)} {sortField === 'coverage' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th
                className="sortable-th"
                onClick={() => toggleSort('priority')}
                aria-sort={sortField === 'priority' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_priority', lang)} {sortField === 'priority' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th
                className="sortable-th"
                onClick={() => toggleSort('status')}
                aria-sort={sortField === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                {translate('col_status', lang)} {sortField === 'status' ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
              </th>
              <th className="text-center">{translate('col_actions', lang)}</th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan="7" className="table-empty-cell">
                  {translate('no_matching_parcels', lang)}
                </td>
              </tr>
            ) : (
              sortedRows.map((f) => {
                const p = f.properties || {}
                const id = p.parcel_id || p.id
                const isSelected = activeSelectedId === id
                const statusKey = getParcelStatus(p)
                const prioKey = getParcelPrio(p)
                const landuseStr = getParcelLanduse(p)
                const luColor = LANDUSE_TINT[landuseStr] || '#64748b'
                const covPct = p.building_coverage != null ? `${Math.round(p.building_coverage * 100)}%` : '—'
                const displayId = p.parcel_id || p.plot_code || p.id_short || `TMP-${String(p.id || '').padStart(4, '0')}`

                return (
                  <tr
                    key={id || displayId}
                    className={`parcel-table-row ${isSelected ? 'row-selected' : ''}`}
                    onClick={() => handleRowSelect(f)}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRowSelect(f)
                    }}
                  >
                    <td className="font-mono font-bold">
                      {displayId}
                    </td>
                    <td className="text-right font-mono">
                      {Math.round(p.area_m2 || 0).toLocaleString()}
                    </td>
                    <td>
                      <span className="landuse-pill">
                        <span className="landuse-dot" style={{ backgroundColor: luColor }} />
                        {getLanduseLabel(landuseStr)}
                      </span>
                    </td>
                    <td className="text-right font-mono">{covPct}</td>
                    <td>
                      <span className={`prio-chip prio-${prioKey.toLowerCase()}`}>
                        {getPriorityLabel(prioKey)}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${statusKey.toLowerCase()}`}>
                        {getStatusLabel(statusKey)}
                      </span>
                    </td>
                    <td>
                      <div className="table-row-actions">
                        <button
                          type="button"
                          className="table-action-btn inspect-btn"
                          onClick={(e) => handleInspect(f, e)}
                          title={translate('action_inspect', lang)}
                        >
                          🗺️ {translate('action_inspect', lang)}
                        </button>
                        <button
                          type="button"
                          className="table-action-btn quick-approve-btn"
                          onClick={(e) => handleQuickDecide(f, 'approved', e)}
                          title="Quick Approve"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          className="table-action-btn quick-flag-btn"
                          onClick={(e) => handleQuickDecide(f, 'flagged', e)}
                          title="Quick Field Check"
                        >
                          ?
                        </button>
                        <button
                          type="button"
                          className="table-action-btn quick-reject-btn"
                          onClick={(e) => handleQuickDecide(f, 'rejected', e)}
                          title="Quick Reject"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
