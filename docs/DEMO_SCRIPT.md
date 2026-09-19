# Demo video script (about 90 seconds)

Open the deployed link full-screen at 1080p. Record the browser tab. The steps below follow the team storyboard
(Clip 3: AI feature segmentation) and continue through validation and review.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Village scene, step 1 | "This is a drone orthomosaic. It is georeferenced; the app reads its CRS and keeps it." |
| 0:08 | Click **Play the pipeline**, scan line sweeps, SAM segments appear | "A SAM-family model outlines every object, without knowing what they are yet." |
| 0:20 | Class masks | "Segments are labelled from evidence: buildings, trees, and the lanes between." |
| 0:30 | Raw outline flips to cleaned polygons; point at the vertex numbers | "Raw masks are jagged. Simplification and edge fitting cut vertices and square the corners." |
| 0:42 | Evidence layers, then candidate parcels with plot numbers | "A roof is not a legal parcel. Each road-bounded block is divided between the buildings inside it." |
| 0:55 | Topology validation tab, click a flag | "Deterministic geometry rules test every polygon. Nothing is silently accepted." |
| 1:05 | Officer review: select a plot, **Edit boundary**, drag a corner into a neighbour | "The officer edits. Overlap with a neighbour is caught instantly." |
| 1:15 | Click **Resolve**, then **Approve** | "One click resolves it. The decision is logged." |
| 1:22 | Export menu | "Approved parcels export as GeoJSON, plus a GeoPackage for QGIS and ArcGIS." |
| 1:28 | Report tab | "No accuracy is claimed until reference polygons are loaded." |

Tips: record the scene switch to the dense-town image at the end. Use a fresh browser profile so no old review state shows.
