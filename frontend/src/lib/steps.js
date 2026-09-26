// The pipeline as the officer (and the jury) walks through it. Order follows the team's
// storyboard: input -> AI analysis -> feature masks -> raster-to-vector -> evidence layers
// -> candidate parcels -> validation -> review.
export const STEPS = [
  {
    id: 'input',
    title: 'Orthomosaic in',
    blurb: 'A georeferenced drone orthomosaic is read with its CRS and transform kept intact. Nothing is stitched or corrected here - that happens upstream.',
    vis: { ortho: true },
  },
  {
    id: 'sam',
    title: 'SAM proposes segments',
    blurb: 'A SAM-family model (MobileSAM) outlines every distinct object it can see. It does not know what they are yet.',
    vis: { ortho: true, segments: true },
  },
  {
    id: 'classes',
    title: 'Segments become features',
    blurb: 'Segments are labelled from evidence: roof-like shape and colour for buildings, green dominance for vegetation. Ground left between them becomes lanes and open ground.',
    vis: { ortho: true, masks: true },
  },
  {
    id: 'vector',
    title: 'Masks become clean polygons',
    blurb: 'Pixel masks turn into georeferenced polygons. Simplification thins the vertices; edge fitting then squares up the corners.',
    vis: { ortho: true, buildingsRaw: true },
    regToggle: true,
  },
  {
    id: 'evidence',
    title: 'Evidence layers',
    blurb: 'Buildings, road corridors and vegetation are kept as separate evidence. A roof is not a legal parcel, so it is only one input.',
    vis: { ortho: true, buildings: true, roads: true, vegetation: true },
  },
  {
    id: 'parcels',
    title: 'Candidate parcels',
    blurb: 'Each road-bounded block is divided between the buildings inside it. Ground is shared out to the nearest building up to a set-back limit.',
    vis: { ortho: true, parcels: true, labels: true, buildings: true },
    styleMode: 'landuse',
  },
  {
    id: 'validate',
    title: 'Topology validation',
    blurb: 'Deterministic geometry rules test every polygon: overlaps, gaps, slivers, buildings on roads, buildings split across parcels, parcels with no road access.',
    vis: { ortho: true, parcels: true, buildings: true, issues: true, labels: true },
    styleMode: 'landuse',
    fixToggle: true,
  },
  {
    id: 'review',
    title: 'Officer review',
    blurb: 'Nothing here is a legal record. The officer inspects each candidate, edits the boundary, then approves, flags for field survey, or rejects.',
    vis: { ortho: true, parcels: true, labels: true, buildings: true },
    styleMode: 'status',
  },
]

export const LAYER_DEFS = [
  { key: 'ortho', label: 'Orthomosaic' },
  { key: 'segments', label: 'Raw SAM segments' },
  { key: 'masks', label: 'Class masks' },
  { key: 'buildingsRaw', label: 'Building outlines (raw)' },
  { key: 'buildings', label: 'Building footprints' },
  { key: 'roads', label: 'Road corridors' },
  { key: 'vegetation', label: 'Vegetation' },
  { key: 'parcels', label: 'Candidate parcels' },
  { key: 'labels', label: 'Plot numbers' },
  { key: 'issues', label: 'Topology flags' },
]

export const LANDUSE_TINT = {
  'Built-up': '#F2B8A2',
  'Built-up (low coverage)': '#F6D9A3',
  'Vegetated plot': '#B7DDB0',
  'Vacant / open plot': '#E6DFA9',
}

export const STATUS = {
  draft: { label: 'Draft / Unverified', color: '#8C877D' },
  approved: { label: 'Approved', color: '#3F6B4F' },
  flagged: { label: 'Needs field check', color: '#A6752C' },
  rejected: { label: 'Rejected', color: '#9B4234' },
}

export const ISSUE_LABEL = {
  invalid_geometry: 'Invalid geometry',
  parcel_overlap: 'Parcel overlap',
  parcel_gap: 'Gap between parcels',
  sliver_parcel: 'Sliver parcel',
  tiny_parcel: 'Very small parcel',
  building_overlap: 'Buildings overlap',
  building_on_road: 'Building on road corridor',
  building_straddles: 'Building split across parcels',
  no_road_access: 'No road access',
}
