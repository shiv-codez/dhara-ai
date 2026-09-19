"""Quick QA preview: draw the exported layers over the orthomosaic (dev tool)."""
import sys, json
import numpy as np, geopandas as gpd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image
from dhara.config import DATA_OUT

def main(sid, out):
    d = DATA_OUT / sid / "web"
    man = json.load(open(d / "manifest.json"))
    (s, w), (n, e) = man["bounds"]
    img = Image.open(d / "ortho.jpg")
    L = {k: gpd.read_file(d / f"{k}.geojson") for k in ["parcels", "buildings", "roads", "vegetation", "issues", "buildings_raw"]}
    fig, axs = plt.subplots(1, 3, figsize=(24, 24 * (img.height / img.width) / 3 + 1))
    for ax in axs:
        ax.imshow(img, extent=(w, e, s, n)); ax.set_axis_off()
    masks = Image.open(d / "masks.png"); axs[0].imshow(masks, extent=(w, e, s, n)); axs[0].set_title("SAM-derived class masks")
    L["buildings"].plot(ax=axs[1], facecolor=(1, .3, .4, .35), edgecolor="#ff2d55", lw=1)
    L["roads"].plot(ax=axs[1], facecolor=(.2, .5, 1, .35), edgecolor="#1e6fff", lw=.8)
    L["vegetation"].plot(ax=axs[1], facecolor="none", edgecolor="#2ecc71", lw=.6)
    axs[1].set_title("Vector evidence: buildings / roads / vegetation")
    L["parcels"].plot(ax=axs[2], column="landuse", alpha=.35, edgecolor="#ffd60a", lw=1.2, categorical=True)
    L["buildings"].boundary.plot(ax=axs[2], color="#ff2d55", lw=.6)
    if len(L["issues"]):
        L["issues"].plot(ax=axs[2], color="cyan", markersize=25, edgecolor="k", alpha=.9)
    axs[2].set_title(f"Candidate parcels ({len(L['parcels'])}) + topology issues ({len(L['issues'])})")
    plt.tight_layout(); plt.savefig(out, dpi=70); print("saved", out)

main(sys.argv[1], sys.argv[2])
