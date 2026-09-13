import json,re,collections,math
from pyproj import Transformer
P=json.load(open('raw/bsp_commons_photos.json'))
tr=Transformer.from_crs(4326,26919,always_xy=True)
E0,N1,W,H,B=492696,5118732,8757,15312,3
DIRS={'north':0,'north-northeast':22.5,'northeast':45,'east-northeast':67.5,'east':90,'east-southeast':112.5,'southeast':135,'south-southeast':157.5,'south':180,'south-southwest':202.5,'southwest':225,'west-southwest':247.5,'west':270,'west-northwest':292.5,'northwest':315,'north-northwest':337.5}
out=[]; skipped=collections.Counter()
for p in P:
    t=p['title'][5:]
    if p['mime']!='image/jpeg': skipped['tiff']+=1; continue
    # 1) only photographers whose Commons uploads here are landscape photography of the park
    if p['artist'].split(' ')[0] not in ('Famartin','Fredlyfish4','Spenceregan7','Michael'): skipped['artist']+=1; continue
    # 2) the title itself must name a place in the park
    if not re.search(r'Katahdin|Baxter|Knife Edge|Pamola|Hamlin|Chimney|Trail|Peak|Pond|Basin|Brook|Ridge|Tableland|Saddle|Cathedral|Hunt|Abol|Helon|Roaring|Russell|Traveler|Doubletop|Coe|Brothers|OJI|Turner|Nesowadnehunk|Kidney|Daicey|Sandy Stream|Wassataquoik|Togue|Trout|Grand Falls|Caribou Spring|Katahdin Stream', t, re.I): skipped['not-a-place']+=1; continue
    # 3) and not be a close-up of the ground, a plant, a plaque, a person or an old print
    if re.search(r'Noah Dines|plaque|Survey marker|Stunted|Sheep Laurel|Spruce|witch|^Lake|Hinds|Northeast Piscataquis|Close up|Clinton|HRC|Entoloma|Moose', t, re.I): skipped['detail']+=1; continue
    if re.search(r'ISS0|View of Earth|panoramio\.jpg$|\bmap\b|Map of|\.svg|USGS', t) and 'panoramio' not in t: skipped['sat/map']+=1; continue
    if 'Earth Science' in p['artist'] or 'NOAA' in p['artist'] or 'State Department' in p['artist']: skipped['agency']+=1; continue
    e,n=tr.transform(p['lon'],p['lat']); bx=(e-E0)/B; bz=(N1-n)/B
    if not (0<=bx<W and 0<=bz<H): skipped['outside']+=1; continue
    # heading from title
    hdg=None; m=re.search(r'[Vv]iew (?:(?:north|south|east|west)(?:-(?:north|south|east|west)(?:east|west)?)?)', t)
    m=re.search(r'\b[Vv]iew ((?:north|south|east|west)(?:-(?:north|south)?(?:east|west)|-?(?:east|west))?)\b', t)
    if m:
        d=m.group(1).lower(); hdg=DIRS.get(d)
        if hdg is None:
            # forms like "north-northeast"
            hdg=DIRS.get(d.replace('--','-'))
    # keep photos of the view (and summit signs/cairns); drop ground-level detail shots, plants, fungi, people
    pano='anoram' in t or p['w']>2.6*p['h']
    if 'ull 360' in t: hdg=None
    # short caption
    cap=re.sub(r'^\d{4}-\d\d-\d\d \d\d \d\d \d\d ','',t); cap=re.sub(r'\.jpe?g$','',cap,flags=re.I); cap=re.sub(r' in Baxter State Park.*$','',cap); cap=re.sub(r', Piscataquis County, Maine','',cap)
    cap=cap.replace("Mount Katahdin's ","")
    date=p['date'][:10] if p['date'] and re.match(r'\d{4}',p['date']) else ''
    thumb=p['thumb']; full=re.sub(r'/800px-','/2000px-',thumb) if '/800px-' in thumb else p['url']
    out.append({'id':p['id'],'x':round(bx,1),'z':round(bz,1),'lat':round(p['lat'],6),'lon':round(p['lon'],6),'hdg':hdg,'pano':pano,'cap':cap[:140],'date':date,'thumb':thumb,'full':full,'by':p['artist'][:40],'lic':p['lic'],'page':p['page']})
print(len(out),'photos kept; skipped',dict(skipped))
print(sum(1 for o in out if o['hdg'] is not None),'with heading;',sum(1 for o in out if o['pano']),'panoramas')
# where are they? nearest landmark buckets
meta=open('site3/data/meta.js').read(); lm=json.loads(re.search(r'"landmarks":(\[.*?\])\s*,\s*"[a-z]',meta,re.S).group(1)) if False else None
open('site3/data/photos.js','w').write('window.PHOTOS='+json.dumps(out,separators=(',',':'))+';\n')
import os; print(os.path.getsize('site3/data/photos.js')//1024,'KB')

