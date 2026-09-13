# Baxter State Park — two-tier block world

Open **`index.html`** in Chrome, Safari, Edge or Firefox. Keep the whole folder together: the
page streams the terrain from the `data/` folder next to it (378 tiles, ~17 MB total). Works
offline; nothing is downloaded from the internet.

## Two tiers

**Core (3 m blocks, walkable Minecraft-style):** the Katahdin massif, about 13 km × 15.5 km —
Baxter Peak, South Peak, the Knife Edge, Pamola, Chimney Peak, Hamlin Peak and the Hamlin Ridge,
the North Peaks and Howe Peaks, the Northwest Basin, Chimney Pond, Basin Ponds, Roaring Brook
Campground, Sandy Stream Pond, Katahdin Stream Campground, Abol Campground, The Owl, Russell Pond.
Every trail in that area is a dirt path with a tree-free corridor and cairns above treeline
(Hunt, Abol, Saddle, Cathedral, Dudley, Helon Taylor, Knife Edge, Hamlin Ridge, North Basin,
Northwest Basin, Chimney Pond, Russell Pond, Wassataquoik Stream…), the Park Tote Road and the
Roaring Brook Road are gravel, campground buildings are log cabins, ponds and rivers are water,
Baxter Peak and Pamola have their summit signs.

**Rest of the park (smooth terrain from 12 m lidar + aerial imagery):** everything inside the
Baxter State Park boundary and a little beyond — the Brothers, Coe, O-J-I, Doubletop, the
Traveler range, the Turners, Nesowadnehunk, Kidney Pond, Daicey Pond, Trout Brook Farm, South
Branch Pond… You can walk or fly over it; there are no blocks to break, but every trail (yellow),
road (tan), stream (blue), pond and the park boundary (red) are drawn on the ground and named.
The far terrain is draped with the actual aerial photo (3 m over the core, 12 m over the rest of the park), with a gradient sky and distance haze, so mountains in the distance look like the real thing rather than coloured blocks.

Blocks stream in as you move, so the edge of the block world follows you around inside the
core; beyond ~1 km you see the smooth terrain until you get closer.

## Controls

- **W A S D** walk · **mouse** look · **Space** jump · **Shift** sprint
- **Double-tap Space** (while walking) starts flying; **F** toggles it any time. While flying you hold your altitude; hold Space to climb, Shift to descend, and **double-tap Shift** to land (drops you to the ground). Fly speed scales with your height above the terrain: about 65 km/h skimming the ground, ~200 km/h at 400 m up, ~500 km/h a kilometre up. Space climbs, Shift descends. The compass under the minimap shows your heading and current speed while flying.
- **L** list of every named place in the park, grouped — click one to teleport
- **V** real photos. 300 geotagged photographs from Wikimedia Commons (mostly Famartin's 2017 Hunt Trail–Knife Edge–Helon Taylor traverse, plus Hamlin Ridge, Chimney Pond, Roaring Brook and a few historic views) are pinned where they were taken. Walk or fly near one and the four closest appear in a strip on the right, sorted by distance and by how closely the photographer was looking the way you are; an arrow points toward where each was taken. Press V (or click one) to see it fullscreen with the photographer's credit and licence; ← → flip through the others nearby. Camera markers in the world (📷, with a count) show where photos exist; turn them and the strip off under N. Photos load from Commons, so this part needs an internet connection.
- **O** at the back of the Baxter Peak sign
- **T** next peak · **R** back to Baxter Peak
- **Left click** break · **Right click** place · **1–7** choose block
- **[ ]** time of day · **M** minimap zoom (five levels, out to the whole park) · **Esc** release mouse
- **− / =** block draw distance, 5–20 chunks (0.5–1.9 km). Default 10. Each step adds noticeably more geometry, so if the frame rate drops, step back down. Your choice is remembered between sessions.

The HUD shows elevation, lat/lon, the nearest named place, which trail or road you're on, and
whether you're inside the 3 m core.

## Data

Real photographs: Wikimedia Commons contributors, each credited with its licence (CC BY-SA 4.0 / CC BY / public domain) in the viewer; `pipeline/build_photos.py` turns a Commons geosearch dump into `data/photos.js`.

USGS 3D Elevation Program (lidar DEM) at 3 m for the core and 12 m for the park, both in UTM 19N
so blocks are true squares on the ground. USDA/USGS NAIP aerial imagery for colour. OpenStreetMap
for trails, roads, streams, water bodies, buildings, peaks, campgrounds, lean-tos and the park
boundary (© OpenStreetMap contributors, ODbL). Rendered with three.js.

## Rebuilding

`pipeline/build_park.py` turns the raw downloads (`pipeline/raw/…`, not included here because of
size — they're in your Downloads folder as `core_dem_*.tif`, `core_naip_*.jpg`, `park_dem_*.tif`,
`park_naip.jpg`, `park_osm.json`) into `data/`. Constants at the top define the two grids. To
build a different park: fetch a DEM + imagery for a new bbox in that zone's UTM, drop them in,
change the constants, run the script.

## Known quirks

- Pond surfaces come from lidar over water, so they read a few metres high.
- The aerial photo has a cloud over the Keep Ridge slopes and shadows in the deep basins; the
  land-cover classification follows the photo, so a few shaded cliffs read as forest edge.
- Outside the core, streams and trails are drawn as lines on the smooth terrain and can dip into
  it on steep slopes.
