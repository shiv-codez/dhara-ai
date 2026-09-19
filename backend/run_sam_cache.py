"""Run MobileSAM on the georeferenced demo orthomosaics and cache the raw instance masks."""
import sys, time
from dhara.config import SCENES, DATA_RAW, DATA_OUT, Params
from dhara.georef import create_demo_geotiff, read_orthomosaic
from dhara.segment import MobileSamSegmenter, save_instances

# per-scene knobs: big scenes are tiled and use a leaner prompt grid on CPU
OVERRIDES = {"town_dense": dict(tile_size_px=720, tile_overlap_px=96, points_per_side=24, points_per_batch=16)}
ids = sys.argv[1:] or list(SCENES)
for sid in ids:
    sc = SCENES[sid]
    seg = MobileSamSegmenter(Params(**OVERRIDES.get(sid, {})))
    tif = DATA_OUT / sid / "orthomosaic.tif"
    create_demo_geotiff(sc, DATA_RAW / sc.image, tif)
    rgb, tr, crs, tags = read_orthomosaic(tif)
    print(f"[{sid}] {rgb.shape}, crs={crs}, tags={tags}", flush=True)
    t = time.time()
    inst = seg.segment(rgb, sc.gsd_m, log=lambda s: print(s, flush=True), checkpoint=DATA_OUT / sid / 'tiles')
    save_instances(inst, DATA_OUT / sid / "sam_instances.pkl")
    print(f"[{sid}] {len(inst)} instances cached in {time.time()-t:.0f}s", flush=True)
