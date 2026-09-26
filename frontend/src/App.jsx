import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapView from './components/MapView.jsx'
import StepRail from './components/StepRail.jsx'
import RightPanel, { sortQueueFeatures } from './components/RightPanel.jsx'
import Legend from './components/Legend.jsx'
import TableView from './components/TableView.jsx'
import OnboardingHint from './components/OnboardingHint.jsx'
import { STEPS, STATUS } from './lib/steps.js'
import { translate } from './lib/i18n.js'
import {
  loadIndex,
  loadScene,
  loadSaved,
  saveSaved,
  backupSaved,
  download,
  exportParcels,
  exportLabels,
  exportLabelsFromBackup,
} from './lib/data.js'
import { overlapsFor, resolveOverlaps, areaM2, boundsOf } from './lib/geo.js'
import { importResultsZip } from './lib/importZip.js'
import { computeMetrics } from './lib/metrics.js'

const STEP_MS = 2600

function ImportErrorModal({ error, onClose, lang = 'en' }) {
  if (!error) return null
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-err-title">
      <div className="modal-box import-error-box">
        <div className="modal-head">
          <h3 id="import-err-title">{translate('import_err_title', lang)}</h3>
        </div>
        <div className="modal-body">
          <p className="import-err-msg">{error}</p>
          <div className="callout info">
            <p>
              Dhara.ai accepts ZIP packages generated with <code>python -m dhara.cli pack &lt;scene&gt;</code> or downloaded from the Google Colab run.
            </p>
            <p className="fine">
              Ensure the archive contains <code>manifest.json</code> and GeoJSON candidate layers without path traversal or nested folders.
            </p>
          </div>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            {translate('dismiss', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkConfirmModal({ count, onConfirm, onCancel, lang = 'en' }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="bulk-modal-title">
      <div className="modal-box">
        <h3 id="bulk-modal-title">{translate('bulk_modal_title', lang)}</h3>
        <p className="lead">
          {translate('bulk_modal_lead', lang, { count, parcels: count === 1 ? translate('plot', lang) : translate('candidate_parcels', lang) })}
        </p>
        <div className="callout info">
          <p>
            {translate('bulk_modal_desc1', lang)}
          </p>
          <p className="fine">
            {translate('bulk_modal_desc2', lang)}
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {translate('cancel', lang)}
          </button>
          <button type="button" className="btn ok" disabled={count === 0} onClick={onConfirm}>
            {translate('approve', lang)} {count} {count === 1 ? translate('plot', lang) : translate('candidate_parcels', lang)}
          </button>
        </div>
      </div>
    </div>
  )
}

function CompareSliderOverlay({ pos, onChange, stageRef, lang = 'en' }) {
  const isDragging = useRef(false)

  const handlePointerDown = (e) => {
    isDragging.current = true
    try {
      e.target.setPointerCapture?.(e.pointerId)
    } catch {}
  }

  const handlePointerMove = (e) => {
    if (!isDragging.current || !stageRef.current) return
    const rect = stageRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100))
    onChange(Math.round(pct * 10) / 10)
  }

  const handlePointerUp = (e) => {
    isDragging.current = false
    try {
      e.target.releasePointerCapture?.(e.pointerId)
    } catch {}
  }

  return (
    <div
      className="compare-slider-container"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div
        className="compare-divider"
        style={{ left: `${pos}%` }}
        onPointerDown={handlePointerDown}
      >
        <div className="compare-handle" aria-label="Drag compare slider" title={translate('compare_title', lang)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />
          </svg>
        </div>
      </div>
      <span className="compare-badge left">{translate('raw_image', lang)}</span>
      <span className="compare-badge right">{translate('detections_layer', lang)}</span>
    </div>
  )
}

export default function App() {
  const [index, setIndex] = useState([])
  const [sceneId, setSceneId] = useState(null)
  const [scene, setScene] = useState(null)
  const [error, setError] = useState(null)

  // Language Localization State (Task 9.1)
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem('dhara:v1:lang') || 'en'
    } catch {
      return 'en'
    }
  })

  const handleSetLang = (newLang) => {
    setLang(newLang)
    try {
      localStorage.setItem('dhara:v1:lang', newLang)
    } catch {}
  }

  // View Mode: 'map' or 'table' (Task 9.2)
  const [viewMode, setViewMode] = useState('map')

  const [stepIdx, setStepIdx] = useState(0)
  const [vis, setVis] = useState(STEPS[0].vis)
  const [regMode, setRegMode] = useState('clean')
  const [fixMode, setFixMode] = useState('after')
  const [playing, setPlaying] = useState(false)
  const [scanNonce, setScanNonce] = useState(0)

  // Layout & Styling Controls (Step rail collapsed by default to maximize GIS workspace)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 768 : true))
  const [fillEnabled, setFillEnabled] = useState(false)
  const [fillOpacity, setFillOpacity] = useState(0.35)
  const [fitNonce, setFitNonce] = useState(0)

  // Compare Slider State
  const [compareActive, setCompareActive] = useState(false)
  const [comparePos, setComparePos] = useState(50)

  // Parcel & Review State
  const [parcels, setParcels] = useState(null)
  const [rebuildKey, setRebuildKey] = useState(0)
  const [statuses, setStatuses] = useState({})
  const [audit, setAudit] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [overlaps, setOverlaps] = useState([])
  const [tab, setTab] = useState('parcel')
  const [focus, setFocus] = useState(null)
  const [inspectTarget, setInspectTarget] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // Bulk Actions
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkUndoState, setBulkUndoState] = useState(null)

  // Invalidation & Data Fingerprint Banner
  const [invalidationBanner, setInvalidationBanner] = useState(null)

  // Imported Scenes & ZIP Dropzone
  const [importedScenes, setImportedScenes] = useState({})
  const [importError, setImportError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Ground Truth Evaluation State (Task 6)
  const [referenceData, setReferenceData] = useState(null)
  const [referenceSource, setReferenceSource] = useState(null)
  const [referenceError, setReferenceError] = useState(null)

  // Reset reference evaluation on scene switch to prevent cross-scene contamination
  useEffect(() => {
    setReferenceData(null)
    setReferenceSource(null)
    setReferenceError(null)
  }, [sceneId])

  // Compute Ground-truth accuracy & boundary metrics when reference layer is present
  const groundTruthResult = useMemo(() => {
    if (!referenceData || !scene?.data?.buildings) return null
    try {
      return computeMetrics(scene.data.buildings, referenceData, 0.5, 0.5)
    } catch (err) {
      console.error('Ground-truth evaluation failed:', err)
      return null
    }
  }, [referenceData, scene])

  const handleLoadReferenceFile = useCallback(async (file) => {
    if (!file) return
    try {
      setReferenceError(null)
      const text = await file.text()
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('File is not valid JSON.')
      }
      if (parsed.type !== 'FeatureCollection' && parsed.type !== 'Feature') {
        throw new Error('GeoJSON must be a FeatureCollection or Feature.')
      }
      const fc = parsed.type === 'FeatureCollection' ? parsed : { type: 'FeatureCollection', features: [parsed] }
      const polyFeatures = (fc.features || []).filter(
        (f) => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      )
      if (polyFeatures.length === 0) {
        throw new Error('No Polygon or MultiPolygon geometries found in reference file.')
      }
      setReferenceData(fc)
      setReferenceSource({ name: file.name, isSample: false, count: polyFeatures.length })
    } catch (err) {
      setReferenceError(err.message || 'Failed to load reference file.')
    }
  }, [])

  const handleLoadSampleReference = useCallback(async () => {
    try {
      setReferenceError(null)
      const res = await fetch(`data/${sceneId}/reference_buildings.geojson`)
      if (!res.ok) {
        throw new Error(`Sample reference data not available for scene "${sceneId}".`)
      }
      const fc = await res.json()
      const polyFeatures = (fc.features || []).filter(
        (f) => f && f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')
      )
      setReferenceData(fc)
      setReferenceSource({
        name: 'village_tiled_reference_buildings.geojson',
        isSample: true,
        count: polyFeatures.length,
      })
    } catch (err) {
      setReferenceError(err.message || 'Could not load sample reference data.')
    }
  }, [sceneId])

  const handleClearReference = useCallback(() => {
    setReferenceData(null)
    setReferenceSource(null)
    setReferenceError(null)
  }, [])

  const timers = useRef([])
  const stageRef = useRef(null)

  // ------------------------------------------------------------------ import file handler
  const handleImportFile = async (file) => {
    if (!file) return
    try {
      setImportError(null)
      const imported = await importResultsZip(file)
      setImportedScenes((prev) => {
        if (prev[imported.id]?.cleanup) {
          try { prev[imported.id].cleanup() } catch {}
        }
        return { ...prev, [imported.id]: imported }
      })
      setSceneId(imported.id)
    } catch (err) {
      console.error('Import error:', err)
      setImportError(err.message || 'Failed to import results zip.')
    }
  }

  // ------------------------------------------------------------------ window drag & drop
  useEffect(() => {
    let dragCounter = 0
    const onDragEnter = (e) => {
      e.preventDefault()
      dragCounter++
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        setIsDragging(true)
      }
    }
    const onDragOver = (e) => {
      e.preventDefault()
    }
    const onDragLeave = (e) => {
      e.preventDefault()
      dragCounter--
      if (dragCounter <= 0) {
        dragCounter = 0
        setIsDragging(false)
      }
    }
    const onDrop = async (e) => {
      e.preventDefault()
      dragCounter = 0
      setIsDragging(false)
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0]
        await handleImportFile(file)
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importedScenes])

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(importedScenes).forEach((s) => {
        if (s.cleanup) {
          try { s.cleanup() } catch {}
        }
      })
    }
  }, [importedScenes])

  // ------------------------------------------------------------------ load scenes
  useEffect(() => {
    loadIndex().then((idx) => { setIndex(idx); setSceneId(idx[0]?.id) }).catch((e) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!sceneId) return
    let live = true
    setScene(null)
    setInvalidationBanner(null)

    const getSceneData = () => {
      if (sceneId.startsWith('imported:')) {
        const imp = importedScenes[sceneId]
        if (imp) return Promise.resolve(imp)
        return Promise.reject(new Error(`Imported scene "${sceneId}" not found in current session.`))
      }
      return loadScene(sceneId)
    }

    getSceneData()
      .then((s) => {
        if (!live) return
        const saved = loadSaved(sceneId)
        const manifestFp = s.manifest?.data_fingerprint

        const hasSavedState =
          (saved.statuses && Object.keys(saved.statuses).length > 0) ||
          (saved.audit && saved.audit.length > 0) ||
          (saved.edits && Object.keys(saved.edits).length > 0)

        let activeSaved = saved
        if (hasSavedState && saved.fingerprint && manifestFp && saved.fingerprint !== manifestFp) {
          const nonDraftCount = Object.values(saved.statuses || {}).filter(
            (st) => st && st.status && st.status !== 'draft'
          ).length
          const decisionCount = nonDraftCount || Object.keys(saved.statuses || {}).length

          backupSaved(sceneId, saved)

          setInvalidationBanner({
            sceneId,
            count: decisionCount,
            backupData: saved,
          })
          activeSaved = {}
        }

        const edits = activeSaved.edits || {}
        const fc = {
          ...s.data.parcels,
          features: s.data.parcels.features.map((f) => (edits[f.properties.parcel_id] ? { ...f, geometry: edits[f.properties.parcel_id] } : f)),
        }
        setParcels(fc)
        setStatuses(activeSaved.statuses || {})
        setAudit(activeSaved.audit || [])
        setSelectedId(null); setEditingId(null); setOverlaps([])
        setBulkUndoState(null)
        setRebuildKey((k) => k + 1)
        setScene(s)
        goStep(0, false)
      })
      .catch((err) => {
        if (live) setError(err.message || 'Scene data could not be loaded.')
      })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, importedScenes])

  // persist review work
  useEffect(() => {
    if (!scene || !parcels) return
    const edits = {}
    const orig = new Map(scene.data.parcels.features.map((f) => [f.properties.parcel_id, JSON.stringify(f.geometry)]))
    parcels.features.forEach((f) => {
      if (JSON.stringify(f.geometry) !== orig.get(f.properties.parcel_id)) edits[f.properties.parcel_id] = f.geometry
    })
    const featureSnapshots = {}
    scene.data.parcels.features.forEach((f) => {
      const p = f.properties
      featureSnapshots[p.parcel_id] = {
        building_id: p.building_id || '',
        veg_frac: p.veg_frac ?? 0,
        sat: p.sat ?? 0,
        val: p.val ?? 0,
        hue: p.hue ?? 0,
        rect: p.rect ?? 0,
        solidity: p.solidity ?? 0,
        area_m2: p.area_m2 ?? 0,
        ground_likeness: p.ground_likeness ?? 0,
      }
    })
    saveSaved(scene.id, {
      fingerprint: scene.manifest?.data_fingerprint,
      statuses,
      audit,
      edits,
      featureSnapshots,
    })
  }, [scene, parcels, statuses, audit])

  // ------------------------------------------------------------------ steps + walkthrough
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const goStep = useCallback((i, fromPlay) => {
    const s = STEPS[i]
    setStepIdx(i)
    setVis(s.vis)
    setRegMode(s.regToggle ? 'raw' : 'clean')
    if (s.id === 'sam') setScanNonce((n) => n + 1)
    if (s.regToggle && fromPlay) timers.current.push(setTimeout(() => setRegMode('clean'), 1500))
    if (s.id === 'review') setTab('parcel')
    if (s.id === 'validate') setTab('checks')
    if (s.id === 'parcels') setTab('parcel')
  }, [])

  const stop = () => { clearTimers(); setPlaying(false) }
  const play = () => {
    clearTimers(); setPlaying(true); setSelectedId(null); setEditingId(null)
    STEPS.forEach((_, i) => {
      timers.current.push(setTimeout(() => { goStep(i, true); if (i === STEPS.length - 1) setPlaying(false) }, i * STEP_MS))
    })
  }
  useEffect(() => clearTimers, [])
  const manualStep = (i) => { stop(); goStep(i, false) }

  // ------------------------------------------------------------------ review actions & provenance
  const log = useCallback((parcel, text, decidedBy = 'individual') => {
    setAudit((a) => [...a, { t: new Date().toISOString(), parcel, text, decided_by: decidedBy }])
  }, [])

  const setStatus = useCallback((id, status, note, decidedBy = 'individual') => {
    setStatuses((s) => ({
      ...s,
      [id]: {
        status,
        note: note !== undefined ? note : s[id]?.note || '',
        decided_by: decidedBy,
      },
    }))
    const statusLabel = STATUS[status]?.label || status
    log(id, `${statusLabel}${note ? ` - ${note}` : ''}`, decidedBy)
  }, [log])

  const select = useCallback((id, opts = {}) => {
    if (editingId && id !== editingId) finishEdit()
    const parcelId = typeof id === 'object' ? (id?.properties?.parcel_id || id?.id) : id
    setSelectedId(parcelId)
    if (parcelId) {
      setTab('parcel')
      if (!rightOpen) setRightOpen(true)
    }
    if (opts?.inspect && parcelId) {
      setInspectTarget({ id: parcelId, nonce: Date.now() })
    }
  }, [editingId, rightOpen])

  const onGeometryEdit = (id, geometry) => {
    setParcels((fc) => {
      const features = fc.features.map((f) => (f.properties.parcel_id === id ? { ...f, geometry } : f))
      const edited = features.find((f) => f.properties.parcel_id === id)
      setOverlaps(overlapsFor(edited, features))
      return { ...fc, features }
    })
  }
  const startEdit = useCallback(() => {
    if (selectedId) {
      setEditingId(selectedId)
      setOverlaps([])
    }
  }, [selectedId])

  const finishEdit = useCallback(() => {
    if (!editingId || !parcels || !scene) return
    const f = parcels.features.find((x) => x.properties.parcel_id === editingId)
    const orig = scene.data.parcels.features.find((x) => x.properties.parcel_id === editingId)
    if (f && orig) {
      log(editingId, `Boundary edited (${areaM2(orig).toFixed(1)} to ${areaM2(f).toFixed(1)} m²)${overlaps.length ? ', overlap left unresolved' : ''}`, 'individual')
    }
    setEditingId(null)
    setOverlaps([])
  }, [editingId, parcels, scene, overlaps, log])

  const resolve = () => {
    const f = parcels.features.find((x) => x.properties.parcel_id === editingId)
    const geometry = resolveOverlaps(f, overlaps, parcels.features)
    setParcels((fc) => ({ ...fc, features: fc.features.map((x) => (x.properties.parcel_id === editingId ? { ...x, geometry } : x)) }))
    log(editingId, `Overlap with ${overlaps.map((o) => o.with.slice(-4)).join(', ')} resolved`, 'individual')
    setOverlaps([])
    setRebuildKey((k) => k + 1)
  }

  const resetEdits = () => {
    if (!scene) return
    setParcels(scene.data.parcels)
    setStatuses({})
    setAudit([])
    setEditingId(null)
    setOverlaps([])
    setSelectedId(null)
    setBulkUndoState(null)
    setRebuildKey((k) => k + 1)
  }

  // ------------------------------------------------------------------ bulk actions
  const bulkApproveLow = useCallback(() => {
    if (!parcels) return
    const lowDraftFeatures = parcels.features.filter((f) => {
      const prio = f.properties.review_priority
      const st = statuses[f.properties.parcel_id]?.status || 'draft'
      return prio === 'Low' && st === 'draft'
    })
    if (lowDraftFeatures.length === 0) return

    const prevMap = {}
    const newStatuses = { ...statuses }
    const affectedIds = []

    lowDraftFeatures.forEach((f) => {
      const id = f.properties.parcel_id
      affectedIds.push(id)
      prevMap[id] = statuses[id] || { status: 'draft' }
      newStatuses[id] = {
        status: 'approved',
        note: 'Bulk approved (Low priority candidate)',
        decided_by: 'bulk',
      }
    })

    setStatuses(newStatuses)
    setBulkUndoState({ count: affectedIds.length, ids: affectedIds, prevMap })
    log('ALL_LOW', `Bulk approved ${affectedIds.length} Low priority candidate parcels`, 'bulk')
  }, [parcels, statuses, log])

  const undoBulkApprove = useCallback(() => {
    if (!bulkUndoState) return
    const { ids, prevMap } = bulkUndoState
    setStatuses((s) => {
      const next = { ...s }
      ids.forEach((id) => {
        if (prevMap[id]) {
          next[id] = prevMap[id]
        } else {
          delete next[id]
        }
      })
      return next
    })
    log('ALL_LOW', `Undid bulk approval of ${ids.length} Low priority parcels`, 'bulk')
    setBulkUndoState(null)
  }, [bulkUndoState, log])

  // ------------------------------------------------------------------ review queue navigation
  const sortedQueue = useMemo(() => (parcels ? sortQueueFeatures(parcels.features) : []), [parcels])

  const goToNextInQueue = useCallback(() => {
    if (!sortedQueue.length) return
    const unreviewed = sortedQueue.filter((f) => (statuses[f.properties.parcel_id]?.status || 'draft') === 'draft')
    if (unreviewed.length === 0) {
      const currIdx = sortedQueue.findIndex((f) => f.properties.parcel_id === selectedId)
      const nextFeature = sortedQueue[(currIdx + 1) % sortedQueue.length]
      if (nextFeature) {
        select(nextFeature.properties.parcel_id)
        setFocus({ bounds: boundsOf(nextFeature), nonce: Date.now() })
      }
      return
    }

    if (!selectedId) {
      const first = unreviewed[0]
      select(first.properties.parcel_id)
      setFocus({ bounds: boundsOf(first), nonce: Date.now() })
      return
    }

    const currIdx = sortedQueue.findIndex((f) => f.properties.parcel_id === selectedId)
    let nextUnreviewed = sortedQueue.slice(currIdx + 1).find((f) => (statuses[f.properties.parcel_id]?.status || 'draft') === 'draft')
    if (!nextUnreviewed) {
      nextUnreviewed = unreviewed[0]
    }
    if (nextUnreviewed) {
      select(nextUnreviewed.properties.parcel_id)
      setFocus({ bounds: boundsOf(nextUnreviewed), nonce: Date.now() })
    }
  }, [sortedQueue, statuses, selectedId, select])

  // ------------------------------------------------------------------ keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e) => {
      // 1. Guard against active typing in inputs, textareas, selects, contenteditable
      const active = document.activeElement
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          active.tagName === 'SELECT' ||
          active.isContentEditable)
      ) {
        return
      }

      // 2. Escape key handles modals, menu, editing, and selection
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (bulkConfirmOpen) {
          setBulkConfirmOpen(false)
          e.preventDefault()
          return
        }
        if (menuOpen) {
          setMenuOpen(false)
          e.preventDefault()
          return
        }
        if (editingId) {
          finishEdit()
          e.preventDefault()
          return
        }
        if (selectedId) {
          select(null)
          e.preventDefault()
          return
        }
        return
      }

      // 3. Guard against open modal or dropdown menu
      if (bulkConfirmOpen || menuOpen) return

      // 4. Guard against boundary editing (only Esc is allowed during editing)
      if (editingId) return

      const key = e.key.toUpperCase()

      if (key === 'N') {
        e.preventDefault()
        goToNextInQueue()
        return
      }

      if (selectedId) {
        if (key === 'A') {
          e.preventDefault()
          setStatus(selectedId, 'approved', undefined, 'individual')
        } else if (key === 'F') {
          e.preventDefault()
          setStatus(selectedId, 'flagged', undefined, 'individual')
        } else if (key === 'R') {
          e.preventDefault()
          setStatus(selectedId, 'rejected', undefined, 'individual')
        } else if (key === 'E') {
          e.preventDefault()
          startEdit()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedId,
    editingId,
    bulkConfirmOpen,
    menuOpen,
    goToNextInQueue,
    setStatus,
    startEdit,
    finishEdit,
    select,
  ])

  // ------------------------------------------------------------------ derived counts
  const total = parcels?.features.length || 0
  const reviewed = Object.values(statuses).filter((s) => s.status && s.status !== 'draft').length
  const approved = Object.values(statuses).filter((s) => s.status === 'approved').length
  const flagged = Object.values(statuses).filter((s) => s.status === 'flagged').length
  const rejected = Object.values(statuses).filter((s) => s.status === 'rejected').length

  const lowDraftCount = useMemo(() => {
    if (!parcels) return 0
    return parcels.features.filter((f) => {
      const isLow = f.properties.review_priority === 'Low'
      const isDraft = (statuses[f.properties.parcel_id]?.status || 'draft') === 'draft'
      return isLow && isDraft
    }).length
  }, [parcels, statuses])

  const parcel = useMemo(() => parcels?.features.find((f) => f.properties.parcel_id === selectedId) || null, [parcels, selectedId])
  const issues = useMemo(() => (scene ? (fixMode === 'before' ? scene.data.issues_before_fix : scene.data.issues).features : []), [scene, fixMode])
  const styleMode = STEPS[stepIdx].styleMode || 'landuse'

  const allSceneOptions = useMemo(() => {
    const builtIn = index || []
    const imported = Object.values(importedScenes).map((s) => ({
      id: s.id,
      title: s.title,
    }))
    return [...builtIn, ...imported]
  }, [index, importedScenes])

  if (error) return <div className="boot"><h1>Dhara.ai</h1><p>{error}</p></div>
  if (!scene || !parcels) return <div className="boot"><h1>Dhara.ai</h1><p>Loading scene…</p></div>

  const m = scene.manifest
  const appClasses = ['app', !leftOpen ? 'no-left' : '', !rightOpen ? 'no-right' : ''].filter(Boolean).join(' ')

  return (
    <div className={appClasses}>
      <header className="top">
        <button
          type="button"
          className="panel-toggle-btn"
          onClick={() => setLeftOpen((o) => !o)}
          title={leftOpen ? 'Hide pipeline rail' : 'Show pipeline rail'}
          aria-label={leftOpen ? 'Hide pipeline rail' : 'Show pipeline rail'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>

        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#4A2E44" />
            <path d="M7 9h11l7 5v9H7z" fill="none" stroke="#F5F4F1" strokeWidth="2" strokeLinejoin="round" />
            <path d="M7 16h18M16 9v14" stroke="#E2566B" strokeWidth="2" />
          </svg>
          <div>
            <h1>Dhara.ai</h1>
            <p>{translate('tagline', lang)}</p>
          </div>
        </div>

        <label className="scene-pick">
          <span className="sr">{translate('scene', lang)}</span>
          <select value={sceneId} onChange={(e) => { stop(); setSceneId(e.target.value) }}>
            {allSceneOptions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>

        <button
          type="button"
          className="btn open-results-btn"
          onClick={() => fileInputRef.current?.click()}
          title={translate('open_results_title', lang)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
          </svg>
          {translate('open_results', lang)}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) {
              handleImportFile(e.target.files[0])
              e.target.value = ''
            }
          }}
        />

        {/* View Mode Switcher (Map vs Table & Dashboard) */}
        <div className="view-mode-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`view-mode-btn ${viewMode === 'map' ? 'active' : ''}`}
            onClick={() => setViewMode('map')}
          >
            🗺️ {translate('view_map', lang)}
          </button>
          <button
            type="button"
            className={`view-mode-btn ${viewMode === 'table' ? 'active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            📊 {translate('view_table', lang)}
          </button>
        </div>

        {/* Live Officer Header Progress */}
        <div className="header-progress" aria-label="Review progress">
          <div className="progress-summary">
            <span className="progress-label font-mono">
              {translate('reviewed_progress', lang)} <b>{reviewed}</b>/{total} ({total > 0 ? Math.round((reviewed / total) * 100) : 0}%)
            </span>
          </div>
          <div className="multi-progress-bar" role="progressbar" aria-valuenow={reviewed} aria-valuemin="0" aria-valuemax={total}>
            <span className="bar-approved" title={`${approved} approved`} style={{ width: `${(approved / Math.max(total, 1)) * 100}%` }} />
            <span className="bar-flagged" title={`${flagged} flagged`} style={{ width: `${(flagged / Math.max(total, 1)) * 100}%` }} />
            <span className="bar-rejected" title={`${rejected} rejected`} style={{ width: `${(rejected / Math.max(total, 1)) * 100}%` }} />
          </div>
        </div>

        <div className="top-right">
          {/* Language Toggle */}
          <div className="lang-toggle-group" role="group" aria-label={translate('lang_toggle_title', lang)}>
            <button
              type="button"
              className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => handleSetLang('en')}
              title="English"
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${lang === 'hi' ? 'active' : ''}`}
              onClick={() => handleSetLang('hi')}
              title="हिंदी (Hindi)"
            >
              हि
            </button>
          </div>

          {m.georef_source === 'assumed_demo' && (
            <span className="chip" title={translate('assumed_georef_title', lang)}>
              {translate('assumed_georef', lang)}
            </span>
          )}
          <span className="chip draft">{translate('all_draft_chip', lang)}</span>
          <div className="menu">
            <button
              type="button"
              className="btn primary export-btn"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              {translate('export', lang)}
            </button>
            {menuOpen && (
              <div className="menu-list" role="menu" onMouseLeave={() => setMenuOpen(false)}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    download(`${scene.id}_approved.geojson`, exportParcels(parcels, statuses, 'approved'))
                    setMenuOpen(false)
                  }}
                >
                  {translate('export_approved', lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    download(`${scene.id}_dhara_candidates.geojson`, exportParcels(parcels, statuses))
                    setMenuOpen(false)
                  }}
                >
                  {translate('export_all', lang)}
                </button>
                <a role="menuitem" href={scene.urls.gpkg} download onClick={() => setMenuOpen(false)}>
                  {translate('export_gpkg', lang)}
                </a>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    download(`${scene.id}_audit.json`, JSON.stringify(audit, null, 1), 'application/json')
                    setMenuOpen(false)
                  }}
                >
                  {translate('export_audit', lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    download(`${scene.id}_labels.json`, exportLabels(scene.id, parcels, statuses), 'application/json')
                    setMenuOpen(false)
                  }}
                >
                  {translate('export_labels', lang)}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    resetEdits()
                    setMenuOpen(false)
                  }}
                >
                  {translate('discard_edits', lang)}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="panel-toggle-btn"
            onClick={() => setRightOpen((o) => !o)}
            title={rightOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-label={rightOpen ? 'Hide inspector panel' : 'Show inspector panel'}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
          </button>
        </div>
      </header>

      <StepRail
        stepIdx={stepIdx}
        onStep={manualStep}
        playing={playing}
        onPlay={play}
        onStop={stop}
        vis={vis}
        onToggleLayer={(k) => setVis((v) => ({ ...v, [k]: !v[k] }))}
        regMode={regMode}
        onRegMode={setRegMode}
        fixMode={fixMode}
        onFixMode={setFixMode}
        manifest={m}
        lang={lang}
        onClose={() => setLeftOpen(false)}
      />

      <main ref={stageRef} className="stage">
        {/* Dismissible Onboarding Guide (Task 9.3) */}
        <OnboardingHint lang={lang} />

        {/* Crossfade View Transition Container */}
        <div className={`view-pane table-pane ${viewMode === 'table' ? 'active' : 'hidden'}`}>
          <TableView
            parcelsGeoJSON={parcels}
            statuses={statuses}
            selectedId={selectedId}
            selectedFeature={parcel}
            onSelectParcel={select}
            onDecide={setStatus}
            lang={lang}
            onSwitchToMap={() => setViewMode('map')}
          />
        </div>

        <div className={`view-pane map-pane ${viewMode === 'map' ? 'active' : 'hidden'}`}>
          <MapView
            scene={scene}
            vis={vis}
            regMode={regMode}
            fixMode={fixMode}
            styleMode={styleMode}
            parcels={parcels}
            rebuildKey={rebuildKey}
            statuses={statuses}
            selectedId={selectedId}
            onSelect={select}
            editingId={editingId}
            onGeometryEdit={onGeometryEdit}
            overlaps={overlaps}
            focus={focus}
            inspectTarget={inspectTarget}
            fillEnabled={fillEnabled}
            fillOpacity={fillOpacity}
            fitNonce={fitNonce}
            compareActive={compareActive}
            comparePos={comparePos}
            groundTruthResult={groundTruthResult}
          />

          {scanNonce > 0 && <div key={scanNonce} className="scan" aria-hidden="true" />}

          {/* Invalidation Banner when map data was regenerated */}
          {invalidationBanner && (
            <div className="invalidation-banner" role="alert">
              <div className="invalidation-banner-content">
                <span className="banner-icon" aria-hidden="true">⚠️</span>
                <span className="banner-text">
                  {translate('invalidation_msg', lang, {
                    count: invalidationBanner.count,
                    decisions: invalidationBanner.count === 1 ? 'decision was' : 'decisions were',
                  })}
                </span>
                <button
                  type="button"
                  className="btn btn-sm banner-action-btn"
                  onClick={() => {
                    download(
                      `${invalidationBanner.sceneId}_old_review_labels.json`,
                      exportLabelsFromBackup(
                        invalidationBanner.sceneId,
                        invalidationBanner.backupData,
                        scene?.data?.parcels
                      ),
                      'application/json'
                    )
                  }}
                >
                  {translate('export_old_labels', lang)}
                </button>
              </div>
              <button
                type="button"
                className="banner-close-btn"
                onClick={() => setInvalidationBanner(null)}
                aria-label="Dismiss banner"
                title="Dismiss notification"
              >
                ✕
              </button>
            </div>
          )}

          {/* Compare Swipe Slider Overlay */}
          {compareActive && (
            <CompareSliderOverlay
              pos={comparePos}
              onChange={setComparePos}
              stageRef={stageRef}
              lang={lang}
            />
          )}

          {/* Stage Floating Controls */}
          <div className="stage-tag">
            <b>{STEPS[stepIdx].title}</b>
            <span>{stepIdx + 1} {translate('step_progress_of', lang)} {STEPS.length}</span>
          </div>

          <div className="map-toolbar" role="toolbar" aria-label="Map display controls">
            <button
              type="button"
              className="tool-btn"
              onClick={() => setFitNonce((n) => n + 1)}
              title={translate('fit_view_title', lang)}
              aria-label={translate('fit_view_title', lang)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
              </svg>
              <span>{translate('fit_view', lang)}</span>
            </button>

            <button
              type="button"
              className={`tool-btn ${compareActive ? 'active' : ''}`}
              onClick={() => setCompareActive((c) => !c)}
              title={translate('compare_title', lang)}
              aria-label={translate('compare_title', lang)}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v18M8 8l-4 4 4 4M16 8l4 4-4 4" />
              </svg>
              <span>{translate('compare', lang)}</span>
            </button>

            {styleMode !== 'status' && (
              <div className="fill-controls">
                <label className="fill-check">
                  <input
                    type="checkbox"
                    checked={fillEnabled}
                    onChange={(e) => setFillEnabled(e.target.checked)}
                  />
                  <span>{translate('fill', lang)}</span>
                </label>

                {fillEnabled && (
                  <label className="opacity-slider" title={translate('opacity', lang)}>
                    <input
                      type="range"
                      min="0.10"
                      max="0.85"
                      step="0.05"
                      value={fillOpacity}
                      onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
                      aria-label="Parcel fill opacity"
                    />
                    <span>{Math.round(fillOpacity * 100)}%</span>
                  </label>
                )}
              </div>
            )}
          </div>

          <Legend vis={vis} styleMode={styleMode} fillEnabled={fillEnabled} lang={lang} />
        </div>
      </main>

      <RightPanel
        tab={tab}
        onTab={setTab}
        manifest={m}
        parcels={parcels}
        parcel={parcel}
        statuses={statuses}
        onStatus={setStatus}
        audit={audit}
        issues={issues}
        fixMode={fixMode}
        onFocus={(b) => setFocus({ bounds: b, nonce: Date.now() })}
        editing={!!editingId}
        onEditStart={startEdit}
        onEditDone={finishEdit}
        overlaps={overlaps}
        onResolve={resolve}
        reviewed={reviewed}
        approved={approved}
        flagged={flagged}
        rejected={rejected}
        total={total}
        onSelect={select}
        onNextInQueue={goToNextInQueue}
        onBulkApproveOpen={() => setBulkConfirmOpen(true)}
        bulkUndoState={bulkUndoState}
        onUndoBulk={undoBulkApprove}
        groundTruthResult={groundTruthResult}
        referenceSource={referenceSource}
        referenceError={referenceError}
        onLoadReferenceFile={handleLoadReferenceFile}
        onLoadSampleReference={handleLoadSampleReference}
        onClearReference={handleClearReference}
        hasSampleReference={sceneId === 'village_tiled'}
        sceneId={sceneId}
        lang={lang}
        onClose={() => setRightOpen(false)}
      />

      {/* Mobile Drawer Backdrop Overlay */}
      {(leftOpen || rightOpen) && (
        <div
          className="mobile-drawer-backdrop"
          onClick={() => {
            setLeftOpen(false)
            setRightOpen(false)
          }}
          aria-hidden="true"
        />
      )}

      {/* Bulk Approval Confirmation Modal */}
      {bulkConfirmOpen && (
        <BulkConfirmModal
          count={lowDraftCount}
          onConfirm={() => {
            bulkApproveLow()
            setBulkConfirmOpen(false)
          }}
          onCancel={() => setBulkConfirmOpen(false)}
          lang={lang}
        />
      )}

      {/* Drag and Drop Full-Window Overlay */}
      {isDragging && (
        <div className="dropzone-overlay" aria-hidden="true">
          <div className="dropzone-card">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5-5 5 5M12 5v12" />
            </svg>
            <h3>{translate('dropzone_title', lang)}</h3>
            <p>{translate('dropzone_desc', lang)}</p>
          </div>
        </div>
      )}

      {/* Import Error Modal */}
      <ImportErrorModal error={importError} onClose={() => setImportError(null)} lang={lang} />
    </div>
  )
}
