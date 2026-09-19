/**
 * Untrusted ZIP archive importer for Dhara.ai pipeline results.
 * Loads JSZip dynamically, validates structure, enforces security limits,
 * checks manifest and GeoJSON schemas, and creates object URLs.
 */

const MAX_TOTAL_BYTES = 60 * 1024 * 1024 // 60 MB
const MAX_FILE_BYTES = 25 * 1024 * 1024 // 25 MB
const MAX_FEATURES_PER_LAYER = 20000
const MAX_COMPRESSION_RATIO = 100

const EXACT_ALLOWED_FILES = new Set([
  'manifest.json',
  'ortho.jpg',
  'masks.png',
  'segments.png',
  'parcels.geojson',
  'parcels_before_fix.geojson',
  'buildings.geojson',
  'buildings_raw.geojson',
  'roads.geojson',
  'vegetation.geojson',
  'open_ground.geojson',
  'issues.geojson',
  'issues_before_fix.geojson',
])

const GEOJSON_FILES = [
  'parcels',
  'parcels_before_fix',
  'buildings',
  'buildings_raw',
  'roads',
  'vegetation',
  'open_ground',
  'issues',
  'issues_before_fix',
]

const ALLOWED_GEOM_TYPES = new Set([
  'Polygon',
  'MultiPolygon',
  'Point',
  'LineString',
  'MultiLineString',
])

function isAllowedFileName(name) {
  if (EXACT_ALLOWED_FILES.has(name)) return true
  if (name.endsWith('.gpkg') && /^[a-zA-Z0-9_.-]+\.gpkg$/.test(name)) return true
  return false
}

function checkCoordinateBounds(coords, geomType) {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [lon, lat] = coords
    if (isNaN(lon) || isNaN(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      throw new Error(`Coordinates [${lon}, ${lat}] are outside valid WGS84 range (lon [-180, 180], lat [-90, 90]).`)
    }
    return
  }
  for (let i = 0; i < coords.length; i++) {
    checkCoordinateBounds(coords[i], geomType)
  }
}

function validateGeoJSON(name, json) {
  if (!json || typeof json !== 'object') {
    throw new Error(`Invalid GeoJSON in ${name}: root must be a JSON object.`)
  }
  if (json.type !== 'FeatureCollection') {
    throw new Error(`Invalid GeoJSON in ${name}: type must be "FeatureCollection" (found "${json.type}").`)
  }
  if (!Array.isArray(json.features)) {
    throw new Error(`Invalid GeoJSON in ${name}: "features" must be an array.`)
  }
  if (json.features.length > MAX_FEATURES_PER_LAYER) {
    throw new Error(
      `Layer ${name} exceeds the maximum feature limit of ${MAX_FEATURES_PER_LAYER} (${json.features.length} features found).`
    )
  }

  for (let i = 0; i < json.features.length; i++) {
    const f = json.features[i]
    if (!f || f.type !== 'Feature') {
      throw new Error(`Invalid feature at index ${i} in ${name}: must have type "Feature".`)
    }
    if (f.geometry) {
      if (!ALLOWED_GEOM_TYPES.has(f.geometry.type)) {
        throw new Error(
          `Unsupported geometry type "${f.geometry.type}" at index ${i} in ${name}. Allowed types: Polygon, MultiPolygon, Point, LineString, MultiLineString.`
        )
      }
      if (f.geometry.coordinates) {
        checkCoordinateBounds(f.geometry.coordinates, f.geometry.type)
      }
    }
    if (f.properties && typeof f.properties !== 'object') {
      throw new Error(`Invalid properties object at index ${i} in ${name}.`)
    }
  }

  if (name === 'parcels.geojson') {
    for (let i = 0; i < json.features.length; i++) {
      const pid = json.features[i].properties?.parcel_id
      if (!pid || typeof pid !== 'string' || pid.trim() === '') {
        throw new Error(`Parcel feature at index ${i} in parcels.geojson is missing a valid "parcel_id" property.`)
      }
    }
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Invalid manifest.json: root must be a JSON object.')
  }

  if (typeof manifest.schema_version !== 'number' || manifest.schema_version < 1) {
    throw new Error('Invalid manifest.json: missing or invalid "schema_version" (expected integer >= 1).')
  }

  if (!manifest.data_fingerprint || typeof manifest.data_fingerprint !== 'string' || manifest.data_fingerprint.trim() === '') {
    throw new Error('Invalid manifest.json: missing or invalid "data_fingerprint".')
  }

  if (!manifest.scene || typeof manifest.scene !== 'string') {
    throw new Error('Invalid manifest.json: missing or invalid "scene" identifier.')
  }

  // Bounds validation
  if (!Array.isArray(manifest.bounds)) {
    throw new Error('Invalid manifest.json: "bounds" must be an array of coordinates.')
  }

  let minLat, minLon, maxLat, maxLon
  if (manifest.bounds.length === 4 && typeof manifest.bounds[0] === 'number') {
    ;[minLat, minLon, maxLat, maxLon] = manifest.bounds
  } else if (manifest.bounds.length === 2 && Array.isArray(manifest.bounds[0]) && Array.isArray(manifest.bounds[1])) {
    ;[minLat, minLon] = manifest.bounds[0]
    ;[maxLat, maxLon] = manifest.bounds[1]
  } else {
    throw new Error('Invalid manifest.json: "bounds" must be [minLat, minLon, maxLat, maxLon] or [[minLat, minLon], [maxLat, maxLon]].')
  }

  if ([minLat, minLon, maxLat, maxLon].some((v) => typeof v !== 'number' || isNaN(v))) {
    throw new Error('Invalid manifest.json: bounds coordinates must be valid numbers.')
  }
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) {
    throw new Error(`Invalid manifest.json: latitude bounds [${minLat}, ${maxLat}] outside [-90, 90].`)
  }
  if (minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180) {
    throw new Error(`Invalid manifest.json: longitude bounds [${minLon}, ${maxLon}] outside [-180, 180].`)
  }
  if (minLat > maxLat || minLon > maxLon) {
    throw new Error(`Invalid manifest.json: inverted bounds coordinates ([${minLat}, ${minLon}] to [${maxLat}, ${maxLon}]).`)
  }

  // Size validation if present
  if (manifest.size_px) {
    if (!Array.isArray(manifest.size_px) || manifest.size_px.length !== 2 || manifest.size_px.some((n) => typeof n !== 'number' || n <= 0)) {
      throw new Error('Invalid manifest.json: "size_px" must be an array of two positive numbers [width, height].')
    }
  }

  // Counts validation if present
  if (manifest.counts && typeof manifest.counts !== 'object') {
    throw new Error('Invalid manifest.json: "counts" must be an object.')
  }
}

/**
 * Parses and validates an untrusted ZIP file (File or Blob or ArrayBuffer).
 * Returns a fully formed scene object with data and blob URLs.
 */
export async function importResultsZip(fileOrBuffer) {
  // Dynamically import jszip so it is not bundled into the main initial bundle
  const jszipModule = await import('jszip')
  const JSZip = jszipModule.default || jszipModule

  let zip
  try {
    zip = await JSZip.loadAsync(fileOrBuffer)
  } catch (err) {
    throw new Error(`Failed to read ZIP archive: ${err.message || 'Invalid or corrupted zip file'}.`)
  }

  const entries = Object.keys(zip.files)
  if (entries.length === 0) {
    throw new Error('The ZIP archive is empty. Please provide a valid Dhara.ai results archive.')
  }

  let totalUncompressedBytes = 0
  const blobUrls = []

  // Step 1: Security and Whitelist checks
  for (const name of entries) {
    const entry = zip.files[name]

    // Reject directories or directory traversal
    if (entry.dir) {
      // Allow only if it's an empty folder entry whose name has no ..
      if (name.includes('..') || name.startsWith('/') || name.startsWith('\\')) {
        throw new Error(`Archive contains illegal path traversal: "${name}".`)
      }
      continue
    }

    if (name.includes('..') || name.startsWith('/') || name.startsWith('\\') || name.includes('/') || name.includes('\\')) {
      throw new Error(`Archive contains nested or illegal file path: "${name}". Files must be in the root of the archive.`)
    }

    if (!isAllowedFileName(name)) {
      throw new Error(
        `Unexpected file in archive: "${name}". Allowed files: manifest.json, ortho.jpg, masks.png, segments.png, GeoJSON layers, and candidate .gpkg.`
      )
    }

    // Check pre-decompression compression ratio / sizes if metadata available
    const uncomp = entry._data?.uncompressedSize
    const comp = entry._data?.compressedSize
    if (typeof uncomp === 'number') {
      if (uncomp > MAX_FILE_BYTES) {
        throw new Error(`File "${name}" exceeds the maximum allowed size of 25 MB (${(uncomp / (1024 * 1024)).toFixed(1)} MB).`)
      }
      if (typeof comp === 'number' && comp > 0 && uncomp / comp > MAX_COMPRESSION_RATIO) {
        throw new Error(`Suspicious compression ratio detected in "${name}" (possible zip bomb).`)
      }
    }
  }

  if (!zip.files['manifest.json']) {
    throw new Error('Archive is missing required "manifest.json". Please provide a valid Dhara.ai results archive.')
  }
  if (!zip.files['parcels.geojson']) {
    throw new Error('Archive is missing required "parcels.geojson". Please provide a valid Dhara.ai results archive.')
  }

  // Step 2: Read and validate manifest.json
  const manifestRaw = await zip.files['manifest.json'].async('string')
  totalUncompressedBytes += manifestRaw.length
  if (manifestRaw.length > MAX_FILE_BYTES) {
    throw new Error('manifest.json exceeds the 25 MB file limit.')
  }

  let manifest
  try {
    manifest = JSON.parse(manifestRaw)
  } catch {
    throw new Error('manifest.json is not valid JSON.')
  }
  validateManifest(manifest)

  // Step 3: Read and validate GeoJSON layers
  const data = {}
  for (const layerName of GEOJSON_FILES) {
    const fileName = `${layerName}.geojson`
    const entry = zip.files[fileName]
    if (entry) {
      const text = await entry.async('string')
      totalUncompressedBytes += text.length
      if (text.length > MAX_FILE_BYTES) {
        throw new Error(`${fileName} exceeds the 25 MB file limit.`)
      }
      if (totalUncompressedBytes > MAX_TOTAL_BYTES) {
        throw new Error(`Total uncompressed archive size exceeds the maximum limit of 60 MB.`)
      }

      let json
      try {
        json = JSON.parse(text)
      } catch {
        throw new Error(`${fileName} is not valid JSON.`)
      }
      validateGeoJSON(fileName, json)
      data[layerName] = json
    } else {
      data[layerName] = { type: 'FeatureCollection', features: [] }
    }
  }

  // Step 4: Extract raster overlays and .gpkg as Object URLs
  const urls = {}

  if (zip.files['ortho.jpg']) {
    const blob = await zip.files['ortho.jpg'].async('blob')
    totalUncompressedBytes += blob.size
    if (blob.size > MAX_FILE_BYTES) throw new Error('ortho.jpg exceeds the 25 MB file limit.')
    const url = URL.createObjectURL(blob)
    urls.ortho = url
    blobUrls.push(url)
  }

  if (zip.files['masks.png']) {
    const blob = await zip.files['masks.png'].async('blob')
    totalUncompressedBytes += blob.size
    if (blob.size > MAX_FILE_BYTES) throw new Error('masks.png exceeds the 25 MB file limit.')
    const url = URL.createObjectURL(blob)
    urls.masks = url
    blobUrls.push(url)
  }

  if (zip.files['segments.png']) {
    const blob = await zip.files['segments.png'].async('blob')
    totalUncompressedBytes += blob.size
    if (blob.size > MAX_FILE_BYTES) throw new Error('segments.png exceeds the 25 MB file limit.')
    const url = URL.createObjectURL(blob)
    urls.segments = url
    blobUrls.push(url)
  }

  // Find .gpkg
  const gpkgName = entries.find((n) => n.endsWith('.gpkg'))
  if (gpkgName && zip.files[gpkgName]) {
    const blob = await zip.files[gpkgName].async('blob')
    totalUncompressedBytes += blob.size
    if (blob.size > MAX_FILE_BYTES) throw new Error(`${gpkgName} exceeds the 25 MB file limit.`)
    const url = URL.createObjectURL(blob)
    urls.gpkg = url
    blobUrls.push(url)
  }

  if (totalUncompressedBytes > MAX_TOTAL_BYTES) {
    // Revoke created URLs before failing
    blobUrls.forEach((u) => {
      try {
        URL.revokeObjectURL(u)
      } catch {}
    })
    throw new Error(
      `Total uncompressed archive size (${(totalUncompressedBytes / (1024 * 1024)).toFixed(1)} MB) exceeds the 60 MB limit.`
    )
  }

  const sid = `imported:${manifest.scene || 'scene'}`
  const displayTitle = `${manifest.title || manifest.scene || 'Imported scene'} (imported)`

  return {
    id: sid,
    imported: true,
    title: displayTitle,
    description: manifest.description || '',
    manifest,
    urls,
    data,
    blobUrls,
    cleanup() {
      blobUrls.forEach((u) => {
        try {
          URL.revokeObjectURL(u)
        } catch {}
      })
    },
  }
}
