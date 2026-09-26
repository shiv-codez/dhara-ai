# Demo video script (about 90 seconds)

Open the deployed link full-screen at 1080p. Record the browser tab. The steps below follow the team storyboard
(Clip 3: AI feature segmentation) and continue through validation, dashboard analysis, and officer review.

| Time | On screen | Say |
|---|---|---|
| 0:00 | Village scene, first visit with **Onboarding Guide** banner | "Dhara.ai transforms drone orthomosaics into candidate cadastral parcel maps with human-in-the-loop review." |
| 0:06 | Click **Got it** on onboarding banner, toggle **EN / हि** to show Hindi localization | "The interface supports full bilingual localization in English and Hindi while preserving survey codes and metric units." |
| 0:14 | Switch back to EN, click **Play the pipeline**, scan line sweeps, SAM segments appear | "A SAM-family foundation model outlines distinct objects across the drone orthomosaic without prior assumptions." |
| 0:24 | Class masks & evidence layers | "Segments are classified from evidence into roofs, tree cover, and open lane corridors." |
| 0:34 | Regularisation: raw outline flips to cleaned polygons (point at vertex reduction & 90° corners) | "Pixel masks are simplified with Douglas-Peucker and orthogonalised with edge fitting to square up corners." |
| 0:44 | Candidate parcels inferred from road blocks | "A building is not a legal parcel. Road-bounded blocks are partitioned between buildings to form draft parcels." |
| 0:54 | Click **Table & Dashboard** view mode | "Officers get an instant KPI dashboard with total area, review completion progress, parcel size histograms, and sortable attribute tables." |
| 1:04 | Switch back to **Map** view, select a parcel, press **E** (Edit), drag vertex to overlap neighbour | "Topological overlaps are caught instantly by deterministic geometry rules." |
| 1:12 | Click **Resolve**, press **A** to Approve, and use **N** to advance through the review queue | "One click resolves overlaps. The officer uses rapid single-key shortcuts to approve, flag for field survey, or reject." |
| 1:20 | Open **Report** tab -> click **Load sample reference (55 buildings)** | "No accuracy is claimed without ground truth. Loading survey polygons computes live IoU, F1, and sub-metre boundary offsets." |
| 1:28 | Open **Export** menu | "Verified parcels export to GeoJSON and multi-layer GeoPackage for QGIS, along with full review audit logs." |

Tips:
- Use a fresh browser incognito/private window so the onboarding hint banner appears.
- Briefly switch scenes to `town_dense` at the end to demonstrate scalability on dense urban layouts.

