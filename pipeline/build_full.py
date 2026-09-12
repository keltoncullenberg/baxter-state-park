"""Build the whole Baxter State Park as a 3 m block world (strip-based, ~7 GB RAM friendly).

Inputs (./raw3):  park3_dem_{tx}_{ty}.tif / park3_naip_{tx}_{ty}.jpg  (3 cols x 6 rows of 2919x2552, EPSG:26919, 3 m)
                  ../raw/park_osm.json
Outputs (./site3/data): meta.js, lod.js, tex.js, t_{tx}_{ty}.js (256x256 block tiles)
"""
import json, os, math, base64, io, sys, time
import numpy as np
from PIL import Image, ImageDraw
import tifffile
from scipy.ndimage import binary_dilation, gaussian_filter
from pyproj import Transformer
Image.MAX_IMAGE_PIXELS = None

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw3"); OSM_PATH = os.path.join(HERE, "raw", "park_osm.json")
SITE = os.path.join(HERE, "site3"); DATA = os.path.join(SITE, "data"); os.makedirs(DATA, exist_ok=True)

BLOCK = 3.0; BASE = 150.0
E0, N1 = 492696, 5118732
TW, TH, COLS, ROWS = 2919, 2552, 3, 6
W, H = TW*COLS, TH*ROWS                     # 8757 x 15312
TILE = 256; TX, TY = math.ceil(W/TILE), math.ceil(H/TILE)
t0 = time.time(); log = lambda *a: print(f"[{time.time()-t0:6.0f}s]", *a, flush=True)

to_utm = Transformer.from_crs(4326, 26919, always_xy=True)
def ll_to_xz(lat, lon):
    e, n = to_utm.transform(lon, lat); return (e-E0)/BLOCK, (N1-n)/BLOCK
inb = lambda x, z: 0 <= x < W and 0 <= z < H

# ------------------------------------------------------------ heights (uint16 blocks) -------------
log("heights…")
hb = np.zeros((H, W), np.uint16)
for ty in range(ROWS):
    for tx in range(COLS):
        p = os.path.join(RAW, f"park3_dem_{tx}_{ty}.tif")
        if os.path.exists(p): a = tifffile.imread(p).astype(np.float32)
        else: a = np.vstack([tifffile.imread(os.path.join(RAW, f"park3_dem_{tx}_{ty}_h{h}.tif")).astype(np.float32) for h in (0, 1)])
        assert a.shape == (TH, TW), a.shape
        bad = ~np.isfinite(a) | (a < -1000)
        if bad.any(): a[bad] = np.nanmin(np.where(bad, np.nan, a))
        hb[ty*TH:(ty+1)*TH, tx*TW:(tx+1)*TW] = np.clip(np.round((a-BASE)/BLOCK), 1, 65000).astype(np.uint16)
        del a
log("height range (m)", hb.min()*BLOCK+BASE, hb.max()*BLOCK+BASE)

# ------------------------------------------------------------ NAIP as a disk memmap ----------------
naip_path = os.path.join(HERE, "naip3.u8")
if not os.path.exists(naip_path) or os.path.getsize(naip_path) != H*W*3:
    log("imagery memmap…")
    mm = np.memmap(naip_path, np.uint8, "w+", shape=(H, W, 3))
    for ty in range(ROWS):
        for tx in range(COLS):
            im = np.asarray(Image.open(os.path.join(RAW, f"park3_naip_{tx}_{ty}.jpg")).convert("RGB"))
            assert im.shape[:2] == (TH, TW), im.shape
            mm[ty*TH:(ty+1)*TH, tx*TW:(tx+1)*TW] = im
    mm.flush(); del mm
naip = np.memmap(naip_path, np.uint8, "r", shape=(H, W, 3))

# ------------------------------------------------------------ OSM ---------------------------------
log("OSM…")
osm = json.load(open(OSM_PATH))["elements"]
def mask_img(): return Image.new("1", (W, H))
trail_m, road_m, water_m, river_m, bldg_m, wet_m = [mask_img() for _ in range(6)]
trail_d, road_d, water_d, river_d, bldg_d, wet_d = [ImageDraw.Draw(m) for m in (trail_m, road_m, water_m, river_m, bldg_m, wet_m)]
trails, roads, streams, landmarks, boundary, water_polys, bldg_polys = [], [], [], [], [], [], []
ROADISH = {"unclassified", "track", "service", "residential", "tertiary", "secondary", "primary", "road"}
def add_landmark(name, kind, x, z, **kw):
    if name and inb(x, z): landmarks.append({"name": name, "kind": kind, "x": round(x, 1), "y": round(z, 1), **kw})
def centroid(pts): return sum(p[0] for p in pts)/len(pts), sum(p[1] for p in pts)/len(pts)
def ring_xz(g): return [ll_to_xz(p["lat"], p["lon"]) for p in g]
def stitch(segs):
    rings, pool = [], [list(s) for s in segs]
    while pool:
        r = pool.pop(0)
        while pool and (abs(r[-1][0]-r[0][0]) > 0.5 or abs(r[-1][1]-r[0][1]) > 0.5):
            for i, s in enumerate(pool):
                if abs(s[0][0]-r[-1][0]) < 0.5 and abs(s[0][1]-r[-1][1]) < 0.5: r += s[1:]; pool.pop(i); break
                if abs(s[-1][0]-r[-1][0]) < 0.5 and abs(s[-1][1]-r[-1][1]) < 0.5: r += s[::-1][1:]; pool.pop(i); break
            else: break
        rings.append(r)
    return rings
for e in osm:
    t = e.get("tags", {})
    if e["type"] == "node":
        x, z = ll_to_xz(e["lat"], e["lon"])
        if t.get("natural") == "peak": add_landmark(t.get("name"), "peak", x, z, ele=t.get("ele"))
        elif t.get("tourism") in ("camp_site", "camp_pitch", "wilderness_hut", "alpine_hut", "viewpoint", "information", "picnic_site"): add_landmark(t.get("name"), t["tourism"], x, z)
        elif t.get("amenity") in ("shelter", "ranger_station", "parking"): add_landmark(t.get("name"), t["amenity"], x, z)
        elif t.get("place"): add_landmark(t.get("name"), "place", x, z)
        continue
    if e["type"] == "relation":
        if t.get("boundary") == "protected_area":
            for m in e.get("members", []):
                if m.get("geometry"): boundary.append([[round(v, 1) for v in q] for q in ring_xz(m["geometry"])])
        elif t.get("natural") == "water" or t.get("water"):
            outers = stitch([ring_xz(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and m.get("geometry")])
            inners = [ring_xz(m["geometry"]) for m in e.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
            for r in outers:
                if len(r) > 2: water_d.polygon(r, fill=1); water_polys.append((r, [i for i in inners if len(i) > 2]))
            for r in inners:
                if len(r) > 2: water_d.polygon(r, fill=0)
            if outers and t.get("name"): cx, cz = centroid(max(outers, key=len)); add_landmark(t["name"], "water", cx, cz)
        continue
    if "geometry" not in e: continue
    pts = ring_xz(e["geometry"]); hw = t.get("highway")
    if hw in ("winter", "snow_path", "proposed", "construction", "abandoned", "razed", "ski", "corridor") or t.get("abandoned:highway") or t.get("snowmobile") == "designated" and hw == "path" and not t.get("name"):
        continue
    if hw:
        rec = {"name": t.get("name", ""), "pts": [[round(p[0], 1), round(p[1], 1)] for p in pts]}
        if hw in ROADISH: roads.append(rec); road_d.line(pts, fill=1, width=2)
        else: trails.append(rec)
        continue
    ww = t.get("waterway")
    if ww:
        streams.append({"name": t.get("name", ""), "kind": ww, "pts": [[round(p[0], 1), round(p[1], 1)] for p in pts]})
        if ww == "river": river_d.line(pts, fill=1, width=2)
        elif ww == "stream" and t.get("name"): river_d.line(pts, fill=1, width=1)
        continue
    if t.get("natural") == "water" or t.get("water"):
        if len(pts) > 2:
            water_d.polygon(pts, fill=1); water_polys.append((pts, []))
            if t.get("name"): cx, cz = centroid(pts); add_landmark(t["name"], "water", cx, cz)
        continue
    if t.get("natural") == "wetland":
        if len(pts) > 2: wet_d.polygon(pts, fill=1)
        continue
    if t.get("building"):
        if len(pts) > 2: bldg_polys.append(pts)
        if t.get("name"): cx, cz = centroid(pts); add_landmark(t["name"], "building", cx, cz)
        continue
    if t.get("tourism") in ("camp_site", "wilderness_hut", "alpine_hut") or t.get("amenity") in ("shelter", "ranger_station"):
        cx, cz = centroid(pts); add_landmark(t.get("name"), t.get("tourism") or t.get("amenity"), cx, cz)
log("trails", len(trails), "roads", len(roads), "streams", len(streams), "water polys", len(water_polys), "buildings", len(bldg_polys), "landmarks", len(landmarks))

# ------------------------------------------------------------ trails: cells, smoothing, cairns ------
def bresenham(x0, y0, x1, y1):
    pts = []; dx = abs(x1-x0); dy = -abs(y1-y0); sx = 1 if x0 < x1 else -1; sy = 1 if y0 < y1 else -1; err = dx+dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1: break
        e2 = 2*err
        if e2 >= dy: err += dy; x0 += sx
        if e2 <= dx: err += dx; y0 += sy
    return pts
def cells_of(rec):
    cells = []
    for (ax, ay), (bx, by) in zip(rec["pts"], rec["pts"][1:]):
        for c in bresenham(int(ax), int(ay), int(bx), int(by)):
            if inb(*c) and (not cells or cells[-1] != c): cells.append(c)
    return cells
def smooth(cells, maxstep, passes):
    for _ in range(passes):
        changed = False
        for (ax, ay), (bx, by) in zip(cells, cells[1:]):
            d = int(hb[by, bx]) - int(hb[ay, ax])
            if d > maxstep: hb[by, bx] -= (d-maxstep); changed = True
            elif d < -maxstep: hb[ay, ax] -= (-d-maxstep); changed = True
        if not changed: break
cairn_pts = []
for tr in trails:
    cells = cells_of(tr)
    if len(cells) > 1: trail_d.line(cells, fill=1, width=1)
    smooth(cells, 2, 6)
    acc = 0
    for i in range(1, len(cells)-1):
        acc += 1
        if acc < 9: continue
        (px, py), (cx_, cy_), (nx, ny) = cells[i-1], cells[i], cells[i+1]; dx, dy = nx-px, ny-py
        for ox, oy in ((-dy, dx), (dy, -dx)):
            if ox == 0 and oy == 0: continue
            qx, qy = cx_+int(np.sign(ox)), cy_+int(np.sign(oy))
            if inb(qx, qy) and hb[qy, qx]*BLOCK+BASE > 1120 and not water_m.getpixel((qx, qy)) and not trail_m.getpixel((qx, qy)):
                cairn_pts.append((qx, qy)); acc = 0; break
for r in roads: smooth(cells_of(r), 1, 4)
cairn_m = mask_img(); ImageDraw.Draw(cairn_m).point(cairn_pts, fill=1)
log("cairns", len(cairn_pts))

# ------------------------------------------------------------ ponds flat, buildings level (per polygon)
def poly_cells(rings_out, rings_in, grow=0):
    """boolean mask + bbox for a polygon (outer ring + holes), on a local canvas"""
    xs = [p[0] for p in rings_out]; zs = [p[1] for p in rings_out]
    x0, x1 = max(0, int(min(xs))-grow-1), min(W-1, int(max(xs))+grow+1); z0, z1 = max(0, int(min(zs))-grow-1), min(H-1, int(max(zs))+grow+1)
    if x1 <= x0 or z1 <= z0: return None
    im = Image.new("1", (x1-x0+1, z1-z0+1)); d = ImageDraw.Draw(im)
    d.polygon([(p[0]-x0, p[1]-z0) for p in rings_out], fill=1, outline=1)
    for r in rings_in: d.polygon([(p[0]-x0, p[1]-z0) for p in r], fill=0)
    m = np.asarray(im, bool)
    if grow: m = binary_dilation(m, iterations=grow)
    return m, x0, z0
for outer, inners in water_polys:
    r = poly_cells(outer, inners)
    if not r: continue
    m, x0, z0 = r; sub = hb[z0:z0+m.shape[0], x0:x0+m.shape[1]]
    if m.any(): sub[m] = int(np.percentile(sub[m], 15))
bldg_m = mask_img(); bd = ImageDraw.Draw(bldg_m)
for pts in bldg_polys:
    r = poly_cells(pts, [], grow=1)
    if not r: continue
    m, x0, z0 = r; sub = hb[z0:z0+m.shape[0], x0:x0+m.shape[1]]
    if m.any(): sub[m] = int(np.round(sub[m].mean()))
    bd.bitmap((x0, z0), Image.fromarray(m.astype(np.uint8)*255).convert("1"), fill=1)
log("ponds & buildings levelled")

# ------------------------------------------------------------ bands: classify + tiles ---------------
def b64png(arr):
    bio = io.BytesIO(); Image.fromarray(arr).save(bio, "PNG", optimize=True); return base64.b64encode(bio.getvalue()).decode()
def b64jpg(arr, q=80):
    bio = io.BytesIO(); Image.fromarray(arr).save(bio, "JPEG", quality=q); return base64.b64encode(bio.getvalue()).decode()
def crop_mask(m, z0, z1): return np.asarray(m.crop((0, z0, W, z1)), bool)
def norm_col(rgb):
    c = rgb.astype(np.float32); lum = c.mean(-1, keepdims=True)
    return np.clip(c*(0.55+0.45*(110.0/np.maximum(lum, 30))), 0, 255).astype(np.uint8)
type_count = np.zeros(11, np.int64); total_bytes = 0
for ty in range(TY):
    z0, z1 = ty*TILE, min(H, (ty+1)*TILE); zz0, zz1 = max(0, z0-1), min(H, z1+1)
    elev = hb[zz0:zz1].astype(np.float32)*BLOCK+BASE
    gy, gx = np.gradient(elev, BLOCK); slope = np.degrees(np.arctan(np.hypot(gx, gy)))[z0-zz0:z0-zz0+(z1-z0)]
    elev = elev[z0-zz0:z0-zz0+(z1-z0)]
    rgb = np.asarray(naip[z0:z1]); r, g, b = [rgb[..., i].astype(np.float32) for i in range(3)]
    bright = gaussian_filter((r+g+b)/3, 1.0); gn = gaussian_filter(g/np.maximum(r+g+b, 1), 1.0)
    veg = ((gn > 0.350) | ((gn > 0.342) & (bright < 95))) & (bright > 30)
    forest = veg & (elev < 1280) & (bright < 130) & (slope < 40)
    bt = np.zeros((z1-z0, W), np.uint8)
    bt[veg & ~forest] = 1; bt[forest] = 2
    bt[(~veg) & (bright > 120) & (slope < 25) & (elev > 1100)] = 5
    bt[slope > 50] = 0
    wet = crop_mask(wet_m, z0, z1); water = crop_mask(water_m, z0, z1); river = crop_mask(river_m, z0, z1) & ~water
    trail = crop_mask(trail_m, z0, z1); road = crop_mask(road_m, z0, z1); cairn = crop_mask(cairn_m, z0, z1); bldg = crop_mask(bldg_m, z0, z1)
    bt[wet & (bt != 0)] = 10
    hband = hb[z0:z1]; hband[river] = np.maximum(hband[river].astype(np.int32)-1, 1).astype(np.uint16)
    bt[water | river] = 3
    shore = binary_dilation(water, iterations=2) & ~water & ~river; bt[shore] = 7
    bt[road & ~water] = 9; bt[trail & ~water] = 4; bt[cairn & ~trail] = 8; bt[bldg] = 6
    type_count += np.bincount(bt.ravel(), minlength=11)[:11]
    col = norm_col(rgb)
    world = np.zeros((z1-z0, W, 3), np.uint8); world[..., 0] = (hband >> 8) & 255; world[..., 1] = hband & 255; world[..., 2] = bt
    for tx in range(TX):
        x0, x1 = tx*TILE, min(W, (tx+1)*TILE)
        w = np.zeros((TILE, TILE, 3), np.uint8); w[:z1-z0, :x1-x0] = world[:, x0:x1]
        c = np.zeros((TILE, TILE, 3), np.uint8); c[:z1-z0, :x1-x0] = col[:, x0:x1]
        js = f'__T({tx},{ty},"{b64png(w)}","{b64jpg(c)}");'
        open(os.path.join(DATA, f"t_{tx}_{ty}.js"), "w").write(js); total_bytes += len(js)
    if ty % 6 == 0: log(f"band {ty+1}/{TY} tiles written, {total_bytes//1048576} MB so far")
log("types", dict(enumerate(type_count.tolist())), "tiles total", total_bytes//1048576, "MB")

# ------------------------------------------------------------ far terrain @36 m + photo textures + minimap
STEP = 12                                   # blocks per LOD cell (36 m)
from scipy.ndimage import minimum_filter
# far-terrain heights are the MINIMUM over each cell, so the smooth mesh never pokes up through the blocks on sharp ridges
hl = minimum_filter(hb, size=STEP+1)[::STEP, ::STEP].astype(np.int32); LW, LH = hl.shape[1], hl.shape[0]
wl = np.zeros((LH, LW, 3), np.uint8); wl[..., 0] = (hl >> 8) & 255; wl[..., 1] = hl & 255
lod_col = norm_col(np.asarray(naip[::STEP, ::STEP]))
lod = {"W": LW, "H": LH, "cell": STEP, "x0": 0, "z0": 0, "png": b64png(wl), "jpg": b64jpg(lod_col, 78)}
mini = norm_col(np.asarray(naip[::4, ::4]))
open(os.path.join(DATA, "lod.js"), "w").write("window.__LOD=" + json.dumps({"park": lod,
    "mini": {"W": int(mini.shape[1]), "H": int(mini.shape[0]), "cell": 4, "x0": 0, "z0": 0, "jpg": b64jpg(mini, 80)}}) + ";")
def photo(rgb):
    c = rgb.astype(np.float32)/255.0; c = np.clip((c-0.5)*1.08+0.5, 0, 1)**0.97
    hi = c > 0.62; c[hi] = 0.62 + (c[hi]-0.62)*0.55          # soft shoulder: bright granite stays grey, not snow-white
    return (c*255).astype(np.uint8)
N = 64; tex = {}
for tz in range(0, LH-1, N):
    for tx in range(0, LW-1, N):
        nx = min(N, LW-1-tx); nz = min(N, LH-1-tz)
        crop = np.asarray(naip[tz*STEP:(tz+nz)*STEP:2, tx*STEP:(tx+nx)*STEP:2])      # 6 m/px textures
        if crop.size: tex[f"{tx},{tz}"] = b64jpg(photo(crop), 84)
keys = sorted(tex); half = len(keys)//2
open(os.path.join(DATA, "tex.js"), "w").write("window.__TEX={park:" + json.dumps({k: tex[k] for k in keys[:half]}) + "};")
open(os.path.join(DATA, "tex2.js"), "w").write("Object.assign(window.__TEX.park," + json.dumps({k: tex[k] for k in keys[half:]}) + ");")
log("lod.js", os.path.getsize(os.path.join(DATA, "lod.js"))//1024, "KB; tex.js", os.path.getsize(os.path.join(DATA, "tex.js"))//1048576, "MB", len(tex), "textures")

# ------------------------------------------------------------ meta ---------------------------------
_vcount = {}
for _w in trails + roads:
    for _p in _w["pts"]: _k = (round(_p[0]), round(_p[1])); _vcount[_k] = _vcount.get(_k, 0) + 1
def simplify(pts, tol=1.0, keep_junctions=False):
    out = [pts[0]]
    for p in pts[1:-1]:
        if abs(p[0]-out[-1][0]) + abs(p[1]-out[-1][1]) >= tol or (keep_junctions and _vcount.get((round(p[0]), round(p[1])), 0) > 1): out.append(p)
    out.append(pts[-1]); return out
# every other named feature in the park (waterfalls, cliffs, ridges, bays, trailheads, canoe rentals, localities…)
KINDMAP = {("waterway","waterfall"):"waterfall", ("waterway","rapids"):"waterfall", ("natural","spring"):"spring", ("natural","cliff"):"terrain", ("natural","ridge"):"terrain",
           ("natural","massif"):"terrain", ("natural","cape"):"terrain", ("natural","bay"):"water", ("place","islet"):"water", ("place","locality"):"place",
           ("highway","trailhead"):"trailhead", ("amenity","boat_rental"):"canoe", ("tourism","picnic_site"):"picnic_site", ("tourism","camp_pitch"):"camp_pitch",
           ("building","cabin"):"building", ("waterway","dam"):"terrain", ("leisure","slipway"):"canoe"}
names_path = os.path.join(HERE, "raw", "park_names.json")
if os.path.exists(names_path):
    for e in json.load(open(names_path))["elements"]:
        t = e.get("tags", {}); kind = None
        for (k, v), kk in KINDMAP.items():
            if t.get(k) == v: kind = kk; break
        if not kind: continue
        c = e.get("center") or ({"lat": e["lat"], "lon": e["lon"]} if "lat" in e else None)
        if not c: continue
        x, z = ll_to_xz(c["lat"], c["lon"]); add_landmark(t.get("name"), kind, x, z)
# USGS GNIS official names (basins, ridges, ravines, notches, falls…) that OSM lacks
gnis_path = os.path.join(HERE, "raw", "park_gnis.json")
if os.path.exists(gnis_path):
    GN = {"Valley":"terrain","Basin":"terrain","Ridge":"terrain","Gap":"terrain","Cliff":"terrain","Flat":"terrain","Pillar":"terrain","Cape":"terrain","Range":"terrain","Bend":"terrain",
          "Island":"water","Lake":"water","Bay":"water","Channel":"water","Swamp":"water","Falls":"waterfall","Rapids":"waterfall","Spring":"spring","Summit":"peak","Populated Place":"place"}
    have = set(l["name"] for l in landmarks) | set(t["name"] for t in trails) | set(s["name"] for s in streams)
    for name, fc, lat, lon in json.load(open(gnis_path)):
        if name in have or fc not in GN: continue
        x, z = ll_to_xz(lat, lon); add_landmark(name, GN[fc], x, z, src="gnis"); have.add(name)
seen = set(); lm = []
for L in landmarks:
    k = (L["name"], L["kind"])
    if k not in seen: seen.add(k); lm.append(L)
meta = {"block_m": BLOCK, "base_elev_m": BASE, "utm": {"zone": 19, "e0": E0, "n1": N1},
        "core": {"W": W, "H": H, "tile": TILE, "TX": TX, "TY": TY}, "park": {"x0": 0, "z0": 0, "w": W, "h": H},
        "landmarks": lm,
        "trails": [{"name": t["name"], "pts": simplify(t["pts"], 2.0, True)} for t in trails if len(t["pts"]) > 1],
        "roads": [{"name": t["name"], "pts": simplify(t["pts"], 3.0, True)} for t in roads if len(t["pts"]) > 1],
        "streams": [{"name": s["name"], "kind": s["kind"], "pts": simplify(s["pts"], 4.0)} for s in streams if len(s["pts"]) > 1],
        "boundary": [simplify(r, 4.0) for r in boundary if len(r) > 1]}
open(os.path.join(DATA, "meta.js"), "w").write("window.META=" + json.dumps(meta, separators=(",", ":")) + ";")
log("done. landmarks", len(lm), "meta.js", os.path.getsize(os.path.join(DATA, "meta.js"))//1024, "KB")
