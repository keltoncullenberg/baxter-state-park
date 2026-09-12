# Baxter State Park — the whole park as a 3 m block world

Open **`index.html`** in Chrome, Safari, Edge or Firefox. Keep the whole folder together: the
page streams the terrain from the `data/` folder next to it (378 tiles, ~17 MB total). Works
offline; nothing is downloaded from the internet.

## What's here

**Blocks everywhere.** All 8,757 × 15,312 columns (about 26 × 46 km, the park boundary plus a margin)
are 3 m blocks, streamed in 256×256 tiles as you move — 134 million columns, 2,100 tiles, ~80 MB.
Every trail is a dirt path with a tree-free corridor and cairns above treeline, every road is gravel,
every pond, lake and river is water, campground buildings are log cabins, and Baxter Peak and Pamola
carry their summit signs. Land cover (forest, alpine, talus, granite, bog) comes from the aerial photo
plus slope and elevation.

**Beyond the loaded blocks** (about 1 km by default, `−`/`=` to change) you see the real aerial photo
draped over the 36 m terrain, with a gradient sky and distance haze, so the far ridges look like the
real thing. Trails (yellow), roads (tan), streams (blue) and the park boundary (red) are drawn on it.

**Labels.** Everything with a name in OpenStreetMap plus the USGS Geographic Names database (basins, ridges, ravines, notches, falls) is labelled in 3D: peaks, ponds, lakes and bays,
streams and waterfalls, trails (labelled along their length), roads, campgrounds, lean-tos,
trailheads, canoe rentals, ridges, cliffs, viewpoints and localities. Press **N** to choose which
categories show. Labels appear within a radius that grows as you fly higher, nearest 90 at a time.

**Seasons.** Press **Y** to cycle summer → fall → winter → spring. Fall turns the hardwoods (birch-trunked
trees, mostly below ~900 m) yellow, orange and red and the tundra rusty; winter puts snow on every block
and the far terrain, freezes the ponds and strips the hardwoods bare; spring leaves snowfields above
~1,150 m. Remembered between sessions.

**Distances & route planning.** Aim the crosshair at any trail, from the ground or the air, and the HUD
shows the trail's name and how far along it to the next named point in each direction (junctions,
campgrounds, ponds, peaks). Press **P** for the route planner: click trail points to add waypoints
(U removes the last; Backspace clears the route at any time, even with the planner closed; the panel also has Undo, Clear and Hide/Show buttons if you press Esc to free the mouse) and it routes along the trail network between them,
drawing the route as a pink ribbon with mile markers and listing each leg's distance, trails used,
elevation gain and loss, plus a total and a rough book-pace time. Your route is remembered.

**Adding names yourself.** `data/extra_names.js` is a plain text file you can edit: name, kind,
lat, lon. It ships with The Chimney placed and a to-do list of Katahdin headwall features from the
climbing guides (Waterfall Buttress, the Armadillo, Cilley-Barber, the Diamonds, the Cathedrals,
Saddle Slide, the Gateway…) with blank coordinates — those names are not in USGS or OpenStreetMap,
so they only appear once you fill in a position. The HUD shows lat/lon wherever you stand.

## Controls

- **W A S D** walk · **mouse** look · **Space** jump · **Shift** sprint
- **Double-tap Space** (while walking) starts flying; **F** toggles it any time. While flying you hold your altitude; hold Space to climb, Shift to descend, and **double-tap Shift** to land (drops you to the ground). Fly speed scales with your height above the terrain: about 65 km/h skimming the ground, ~200 km/h at 400 m up, ~500 km/h a kilometre up. Space climbs, Shift descends. The compass under the minimap shows your heading and current speed while flying.
- **L** list of every named place in the park, grouped — click one to teleport (you arrive hovering above it; double-tap Shift to land)
- **N** label categories on/off · **Y** season · **P** route planner
- **T** next peak · **R** back to Baxter Peak
- **Click** break a block · **E** place a block (right-click also works) · **1–7** choose block
- **[ ]** time of day · **M** minimap zoom (five levels, out to the whole park) · **Esc** release mouse
- **− / =** block draw distance, 5–20 chunks (0.5–1.9 km). Default 10. Each step adds noticeably more geometry, so if the frame rate drops, step back down. Your choice is remembered between sessions.

The HUD shows elevation, lat/lon, the nearest named place, which trail or road you're on, and
whether you're inside the 3 m core.

## Data

USGS 3D Elevation Program (lidar DEM) at 3 m for the core and 12 m for the park, both in UTM 19N
so blocks are true squares on the ground. USDA/USGS NAIP aerial imagery for colour. OpenStreetMap
for trails, roads, streams, water bodies, buildings, peaks, campgrounds, lean-tos and the park
boundary (© OpenStreetMap contributors, ODbL). Rendered with three.js.

## Rebuilding

`pipeline/build_full.py` turns the raw downloads (in your Downloads folder: `park3_dem_*.tif`,
`park3_naip_*.jpg`, `park_osm.json`, `park_names.json`) into `data/` in about three minutes, working
in strips so it fits in a few GB of RAM. Constants at the top define the grid. To build a different
park: fetch a DEM + imagery for a new bbox in that zone's UTM (3 m cells, tiles ≤ ~7.5 M px each),
drop them in, change the constants, run the script.

## Known quirks

- Pond surfaces come from lidar over water, so they read a few metres high.
- The aerial photo has a cloud over the Keep Ridge slopes and shadows in the deep basins; the
  land-cover classification follows the photo, so a few shaded cliffs read as forest edge.
- Outside the core, streams and trails are drawn as lines on the smooth terrain and can dip into
  it on steep slopes.
