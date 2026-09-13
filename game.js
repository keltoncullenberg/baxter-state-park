/* Baxter State Park — two-tier voxel world.
   Core (Katahdin massif): 3 m blocks streamed as 256x256 tiles (data/t_x_y.js).
   Everywhere else: smooth far terrain from USGS elevation + NAIP colour (data/lod.js).
   Coordinates: x = east (blocks), z = south (blocks), y = up (blocks). Origin = core NW corner. */
(() => {
'use strict';
const CH = 32, TILE = META.core.tile;
const SEASONS=['summer','fall','winter','spring']; let season='summer'; try{ const s=localStorage.getItem('bsp_season'); if (SEASONS.includes(s)) season=s; }catch(e){}
let VIEW_R = 10; try { const v=+localStorage.getItem('bsp_viewr'); if (v>=5&&v<=20) VIEW_R=v; } catch(e){}   // block draw distance in chunks (- / = keys)
const BLOCK_M = META.block_m, BASE_M = META.base_elev_m;
const CW = META.core.W, CHH = META.core.H, TX = META.core.TX, TY = META.core.TY;

// ---------- palette ------------------------------------------------------------------------
const T = { AIR:0, ROCK:1, ALPINE:2, FOREST:3, WATER:4, TRAIL:5, TALUS:6, WOOD:7, GRAVEL:8, LOG:9, LEAVES:10, STONE:11, PLANKS:12, SNOW:13, CAIRN:14, CAIRNTOP:15, ROOF:16, SIGNPOST:17, ROAD:18, BOG:19, LEAVES_D:20, BIRCH:21 };
const SRC2T = [T.ROCK, T.ALPINE, T.FOREST, T.WATER, T.TRAIL, T.TALUS, T.WOOD, T.GRAVEL, T.CAIRN, T.ROAD, T.BOG];
const BASECOL = {
  [T.ROCK]:[122,120,116], [T.ALPINE]:[112,134,70], [T.FOREST]:[44,82,34], [T.WATER]:[38,96,168],
  [T.TRAIL]:[150,104,58], [T.TALUS]:[152,148,140], [T.WOOD]:[122,84,46], [T.GRAVEL]:[178,170,148],
  [T.LOG]:[94,66,38], [T.LEAVES]:[44,102,42], [T.STONE]:[112,112,110], [T.PLANKS]:[176,136,80], [T.SNOW]:[242,245,250],
  [T.CAIRN]:[98,96,92], [T.CAIRNTOP]:[86,120,200], [T.ROOF]:[74,52,32], [T.SIGNPOST]:[104,74,44], [T.ROAD]:[168,156,132], [T.BOG]:[118,124,66], [T.LEAVES_D]:[84,140,52], [T.BIRCH]:[214,212,204],
};
const NATURAL = new Set([T.ROCK, T.ALPINE, T.FOREST, T.TALUS, T.GRAVEL, T.CAIRN, T.BOG]);
const HOTBAR = [ {t:T.ROCK,n:'granite'}, {t:T.ALPINE,n:'tundra'}, {t:T.LOG,n:'spruce log'}, {t:T.LEAVES,n:'needles'}, {t:T.PLANKS,n:'planks'}, {t:T.SNOW,n:'snow'}, {t:T.WATER,n:'water'} ];

// ---------- tiles ---------------------------------------------------------------------------
const tiles = new Map();            // "tx,ty" -> {state, h:Uint16Array, t:Uint8Array, c:Uint8Array}
const edits = new Map(), signposts = new Map(), dirty = new Set();
let pendingDecodes = 0;
function loadImage(src){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=src; }); }
function requestTile(tx,ty){
  if (tx<0||ty<0||tx>=TX||ty>=TY) return; const k=tx+','+ty; if (tiles.has(k)) return;
  tiles.set(k,{state:'loading', t0:performance.now()});
  const s=document.createElement('script'); s.src=`data/t_${tx}_${ty}.js`; s.onerror=()=>{ tiles.set(k,{state:'missing'}); }; document.head.appendChild(s);
}
window.__T = async function(tx,ty,png,jpg){
  const k=tx+','+ty; pendingDecodes++;
  try{
    const [wi, ci] = await Promise.all([loadImage('data:image/png;base64,'+png), loadImage('data:image/jpeg;base64,'+jpg)]);
    const c=document.createElement('canvas'); c.width=TILE; c.height=TILE; const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(wi,0,0); const d=g.getImageData(0,0,TILE,TILE).data;
    const h=new Uint16Array(TILE*TILE), t=new Uint8Array(TILE*TILE);
    for (let i=0;i<TILE*TILE;i++){ h[i]=(d[i*4]<<8)|d[i*4+1]; t[i]=SRC2T[d[i*4+2]]||T.ROCK; }
    g.drawImage(ci,0,0); const d2=g.getImageData(0,0,TILE,TILE).data; const col=new Uint8Array(TILE*TILE*3);
    for (let i=0;i<TILE*TILE;i++){ col[i*3]=d2[i*4]; col[i*3+1]=d2[i*4+1]; col[i*3+2]=d2[i*4+2]; }
    tiles.set(k,{state:'ready', h, t, c:col});
    // any chunk touching this tile (plus a 1-block border) may now be buildable
    const cx0=Math.floor((tx*TILE-1)/CH), cx1=Math.floor(((tx+1)*TILE)/CH), cz0=Math.floor((ty*TILE-1)/CH), cz1=Math.floor(((ty+1)*TILE)/CH);
    for (let cz=cz0; cz<=cz1; cz++) for (let cx=cx0; cx<=cx1; cx++) dirty.add(cx+','+cz);
  } finally { pendingDecodes--; }
};
const inCore = (x,z) => x>=0 && z>=0 && x<CW && z<CHH;
function tileOf(x,z){ return tiles.get((x>>8)+','+(z>>8)); }   // TILE = 256
function hAt(x,z){
  if (!inCore(x,z)) return Math.round(lodH(x+0.5,z+0.5));
  const tl=tileOf(x,z); if (tl && tl.state==='ready') return tl.h[((z&255)<<8)|(x&255)];
  return Math.round(lodH(x+0.5,z+0.5));
}
function tAt(x,z){ if(!inCore(x,z)) return T.ROCK; const tl=tileOf(x,z); return (tl&&tl.state==='ready') ? tl.t[((z&255)<<8)|(x&255)] : T.ROCK; }
function cAt(x,z,out){ const tl=tileOf(x,z); if(tl&&tl.state==='ready'){ const i=(((z&255)<<8)|(x&255))*3; out[0]=tl.c[i]; out[1]=tl.c[i+1]; out[2]=tl.c[i+2]; return true;} return false; }
function tilesReadyFor(x0,z0,x1,z1){   // all tiles covering [x0..x1]x[z0..z1] loaded?
  for (let tz=Math.max(0,z0>>8); tz<=Math.min(TY-1,z1>>8); tz++) for (let tx=Math.max(0,x0>>8); tx<=Math.min(TX-1,x1>>8); tx++){
    const tl=tiles.get(tx+','+tz); if (!tl) requestTile(tx,tz); if (!tl || tl.state!=='ready') return false; }
  return true;
}

// ---------- LOD height field (for physics outside loaded tiles, and far terrain) -----------
const LOD = { core:null, park:null };
function decodeLod(L){
  return Promise.all([loadImage('data:image/png;base64,'+L.png), loadImage('data:image/jpeg;base64,'+L.jpg)]).then(([wi,ci])=>{
    const c=document.createElement('canvas'); c.width=L.W; c.height=L.H; const g=c.getContext('2d',{willReadFrequently:true});
    g.drawImage(wi,0,0); const d=g.getImageData(0,0,L.W,L.H).data; const h=new Float32Array(L.W*L.H);
    for (let i=0;i<L.W*L.H;i++) h[i]=(d[i*4]<<8)|d[i*4+1];
    g.drawImage(ci,0,0,L.W,L.H); const d2=g.getImageData(0,0,L.W,L.H).data; const col=new Uint8Array(L.W*L.H*3);
    for (let i=0;i<L.W*L.H;i++){ col[i*3]=d2[i*4]; col[i*3+1]=d2[i*4+1]; col[i*3+2]=d2[i*4+2]; }
    return {W:L.W,H:L.H,cell:L.cell,x0:L.x0,z0:L.z0,h,c:col, canvas:c};
  });
}
function lodSample(L,x,z){
  const fx=(x-L.x0)/L.cell, fz=(z-L.z0)/L.cell; const ix=Math.floor(fx), iz=Math.floor(fz);
  if (ix<0||iz<0||ix>=L.W-1||iz>=L.H-1) return null;
  const ax=fx-ix, az=fz-iz; const i=iz*L.W+ix;
  return (L.h[i]*(1-ax)+L.h[i+1]*ax)*(1-az) + (L.h[i+L.W]*(1-ax)+L.h[i+L.W+1]*ax)*az;
}
function lodH(x,z){ let v=null; if (LOD.core && inCore(Math.floor(x),Math.floor(z))) v=lodSample(LOD.core,x,z); if (v===null && LOD.park) v=lodSample(LOD.park,x,z); return v===null ? 0 : v; }

// ---------- procedural detail --------------------------------------------------------------
function hash(x,z,s=0){ let h=(x*374761393 + z*668265263 + s*1274126177)|0; h=(h^(h>>>13))*1274126177|0; return ((h^(h>>>16))>>>0)/4294967296; }
function nearClearing(x,z){
  for (let dz=-4; dz<=4; dz++) for (let dx=-4; dx<=4; dx++){ const tt=tAt(x+dx,z+dz);
    if (tt===T.WOOD) return true;
    if ((tt===T.TRAIL||tt===T.CAIRN||tt===T.ROAD) && Math.abs(dx)<=2 && Math.abs(dz)<=2) return true; }
  return false;
}
function treeAt(x,z){
  if(!inCore(x,z)) return null;
  const t=tAt(x,z);
  if (t===T.FOREST){ if (hash(x,z,1)<0.13){ if (nearClearing(x,z)) return null;
      const elev=hAt(x,z)*BLOCK_M+BASE_M; const df = elev<500?0.6:(elev<900?0.35:0.05);      // hardwoods low, spruce-fir high
      return {trunk:1+(hash(x,z,2)<0.5?1:0), bush:false, decid: hash(x,z,3)<df}; } }
  else if (t===T.ALPINE){ if (hash(x,z,1)<0.035){ if (nearClearing(x,z)) return null; return {trunk:0, bush:true}; } }
  return null;
}
function typeAt(x,y,z){
  if(!inCore(x,z)){ return y <= Math.round(lodH(x+0.5,z+0.5)) ? T.STONE : T.AIR; }
  const e=edits.get(x+','+y+','+z); if (e!==undefined) return e;
  const tl=tileOf(x,z); if (!tl || tl.state!=='ready'){ return y <= Math.round(lodH(x+0.5,z+0.5)) ? T.STONE : T.AIR; }
  const li=((z&255)<<8)|(x&255); const h=tl.h[li];
  if (y<h) return T.STONE;
  const st=tl.t[li];
  if (y===h) return st;
  if (st===T.CAIRN){ if (y===h+1) return T.CAIRN; if (y===h+2) return T.CAIRNTOP; return T.AIR; }
  if (st===T.WOOD){ let edge=false; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (tAt(x+dx,z+dz)!==T.WOOD) edge=true;
    if (y===h+1||y===h+2) return edge ? T.LOG : T.AIR; if (y===h+3) return T.ROOF; return T.AIR; }
  if (y===h+3||y===h+2){ for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ if (tAt(x+dx,z+dz)===T.WOOD){ if (y===hAt(x+dx,z+dz)+3) return T.ROOF; } } }
  if (signposts.has(x+','+z) && y===h+1) return T.SIGNPOST;
  const tr=treeAt(x,z);
  if (tr){ if (tr.bush){ if (y===h+1) return T.LEAVES; } else { const bare=tr.decid&&season==='winter'; if (y<=h+tr.trunk) return tr.decid?T.BIRCH:T.LOG; if (!bare && y<=h+tr.trunk+2) return tr.decid?T.LEAVES_D:T.LEAVES; } }
  for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nt=treeAt(x+dx,z+dz); if (nt&&!nt.bush&&!(nt.decid&&season==='winter')){ if (y===hAt(x+dx,z+dz)+nt.trunk+1) return nt.decid?T.LEAVES_D:T.LEAVES; } }
  return T.AIR;
}
const solid=(x,y,z)=>{ const t=typeAt(x,y,z); return t!==T.AIR && t!==T.WATER; };

// ---------- colours --------------------------------------------------------------------------
const SHADE=[1.0,0.55,0.80,0.80,0.68,0.68]; const tmpc=[0,0,0], tmpk=[0,0,0];
const FALL=[[222,152,40],[206,96,42],[236,196,64],[176,64,44],[228,170,50]];
const GROUND=new Set([T.ROCK,T.ALPINE,T.FOREST,T.TRAIL,T.TALUS,T.GRAVEL,T.ROAD,T.BOG,T.CAIRN,T.CAIRNTOP,T.STONE,T.ROOF]);
function faceColor(type,x,z,face,out){
  const b=BASECOL[type]||BASECOL[T.ROCK]; let r=b[0],g=b[1],bl=b[2];
  if (NATURAL.has(type) && cAt(x,z,tmpk)){ const k=face===0?0.62:0.32; r=r*(1-k)+tmpk[0]*k; g=g*(1-k)+tmpk[1]*k; bl=bl*(1-k)+tmpk[2]*k; }
  if (season!=='summer'){
    const elev=hAt(x,z)*BLOCK_M+BASE_M;
    if (type===T.LEAVES_D){ if (season==='fall'){ const f=FALL[Math.floor(hash(x,z,5)*FALL.length)]; r=f[0]; g=f[1]; bl=f[2]; } else if (season==='spring'){ r=150; g=190; bl=80; } }
    if (season==='fall' && (type===T.ALPINE||type===T.BOG)){ r=r*0.9+40; g=g*0.75+10; bl=bl*0.6; }               // rusty tundra & bog
    if (season==='fall' && type===T.FOREST){ r=r*0.85+30; g=g*0.9; }
    if (season==='winter'){ if (GROUND.has(type) && face===0){ r=228; g=234; bl=244; } else if (GROUND.has(type)){ r=r*0.6+90; g=g*0.6+95; bl=bl*0.6+105; }
      else if (type===T.LEAVES){ if (face===0){ r=205; g=220; bl=232; } else { r=r*0.7+40; g=g*0.7+50; bl=bl*0.7+60; } }
      else if (type===T.WATER){ r=196; g=214; bl=236; } }
    if (season==='spring'){ if (GROUND.has(type) && face===0 && elev>1150 && hash(x,z,9)<Math.min(0.95,(elev-1000)/500)){ r=225; g=232; bl=242; }   // lingering snowfields up high
      else if (type===T.WATER){ r=r*0.9; g=g*0.95; bl=bl; } }
  }
  const s=SHADE[face]*(0.88+0.22*hash(x,z,7+face));
  out[0]=Math.min(255,r*s)/255; out[1]=Math.min(255,g*s)/255; out[2]=Math.min(255,bl*s)/255;
}

// ---------- three.js -------------------------------------------------------------------------
const canvas=document.getElementById('c');
const renderer=new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
const scene=new THREE.Scene(); const camera=new THREE.PerspectiveCamera(72,1,0.1,30000);
const sun=new THREE.DirectionalLight(0xffffff,1); scene.add(sun); const hemi=new THREE.HemisphereLight(0xbfd8ff,0x4a4030,0.35); scene.add(hemi);
scene.fog=new THREE.FogExp2(0xcfe0f5,0.00007);
const skyUni={top:{value:new THREE.Color(0x3f7fd0)},horizon:{value:new THREE.Color(0xcfe0f5)},sunDir:{value:new THREE.Vector3(0,1,0)},sunCol:{value:new THREE.Color(0xfff2d0)},night:{value:0}};
const skyMat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:skyUni,
  vertexShader:'varying vec3 vP; void main(){ vP=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader:'uniform vec3 top,horizon,sunDir,sunCol; uniform float night; varying vec3 vP; void main(){ float h=clamp(vP.y,0.0,1.0); vec3 c=mix(horizon,top,pow(h,0.55)); float s=max(dot(vP,normalize(sunDir)),0.0); c+=sunCol*(pow(s,600.0)*1.5+pow(s,8.0)*0.25*(1.0-night)); if(vP.y<0.0) c=horizon*0.9; gl_FragColor=vec4(c,1.0); }'});
const sky=new THREE.Mesh(new THREE.SphereGeometry(20000,32,16),skyMat); sky.frustumCulled=false; scene.add(sky);
const solidMat=new THREE.MeshLambertMaterial({vertexColors:true});
const waterMat=new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:0.72,depthWrite:false});
const chunks=new Map();
const hl=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002,1.002,1.002)), new THREE.LineBasicMaterial({color:0x000,transparent:true,opacity:0.6})); hl.visible=false; scene.add(hl);
function resize(){ renderer.setSize(innerWidth,innerHeight,false); camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize',resize); resize();

// ---------- chunk meshing --------------------------------------------------------------------
const FACES=[ {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]}, {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]}, {n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]},
  {n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]}, {n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]}, {n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]} ];
function buildChunk(cx,cz){
  const x0=cx*CH, z0=cz*CH; let yMin=1e9,yMax=-1e9;
  for (let z=z0-1; z<=z0+CH; z++) for (let x=x0-1; x<=x0+CH; x++){ if(!inCore(x,z)) continue; const h=hAt(x,z); if(h<yMin)yMin=h; if(h>yMax)yMax=h; }
  if (yMin===1e9) return null; yMin=Math.max(0,yMin-1); yMax+=6;
  for (const [k] of edits){ const p=k.split(','); const ex=+p[0],ey=+p[1],ez=+p[2]; if(ex>=x0-1&&ex<=x0+CH&&ez>=z0-1&&ez<=z0+CH){ if(ey+1>yMax)yMax=ey+1; if(ey-1<yMin)yMin=Math.max(0,ey-1);} }
  const P=CH+2, YR=yMax-yMin+1; const grid=new Uint8Array(P*P*YR); const idx=(lx,ly,lz)=>(ly*P+lz)*P+lx;
  // fast column fill (same rules as typeAt, but per column instead of per cell)
  const put=(lx,lz,y,t)=>{ const ly=y-yMin; if(ly<0||ly>=YR) return; const i=idx(lx,ly,lz); if(grid[i]===T.AIR) grid[i]=t; };
  for (let lz=0; lz<P; lz++) for (let lx=0; lx<P; lx++){
    const x=x0-1+lx, z=z0-1+lz; if(!inCore(x,z)) continue;
    const tl=tileOf(x,z); const ready=tl&&tl.state==='ready';
    const h = ready ? tl.h[((z&255)<<8)|(x&255)] : Math.round(lodH(x+0.5,z+0.5)); const st = ready ? tl.t[((z&255)<<8)|(x&255)] : T.STONE;
    for (let ly=0; ly<YR; ly++){ const y=yMin+ly; if (y<h) grid[idx(lx,ly,lz)]=T.STONE; else if (y===h) grid[idx(lx,ly,lz)]=st; else break; }
    if (!ready) continue;
    if (st===T.CAIRN){ put(lx,lz,h+1,T.CAIRN); put(lx,lz,h+2,T.CAIRNTOP); continue; }
    if (st===T.WOOD){ let edge=false; for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (tAt(x+dx,z+dz)!==T.WOOD) edge=true;
      if (edge){ put(lx,lz,h+1,T.LOG); put(lx,lz,h+2,T.LOG); } put(lx,lz,h+3,T.ROOF); continue; }
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) if (tAt(x+dx,z+dz)===T.WOOD) put(lx,lz,hAt(x+dx,z+dz)+3,T.ROOF);
    if (signposts.has(x+','+z)) put(lx,lz,h+1,T.SIGNPOST);
    const tr=treeAt(x,z);
    if (tr){ if (tr.bush) put(lx,lz,h+1,T.LEAVES); else { const lt=tr.decid?T.LEAVES_D:T.LEAVES, bare=tr.decid&&season==='winter'; for (let y=h+1;y<=h+tr.trunk;y++) put(lx,lz,y,tr.decid?T.BIRCH:T.LOG); if(!bare){ put(lx,lz,h+tr.trunk+1,lt); put(lx,lz,h+tr.trunk+2,lt); } } }
    for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){ const nt=treeAt(x+dx,z+dz); if (nt&&!nt.bush&&!(nt.decid&&season==='winter')) put(lx,lz,hAt(x+dx,z+dz)+nt.trunk+1,nt.decid?T.LEAVES_D:T.LEAVES); }
  }
  for (const [k,v] of edits){ const p=k.split(','); const ex=+p[0],ey=+p[1],ez=+p[2]; const lx=ex-x0+1, lz=ez-z0+1, ly=ey-yMin; if (lx>=0&&lx<P&&lz>=0&&lz<P&&ly>=0&&ly<YR) grid[idx(lx,ly,lz)]=v; }
  const pos=[],nor=[],colr=[],ind=[],wpos=[],wnor=[],wcol=[],wind=[]; let vi=0,wvi=0;
  for (let lz=1; lz<=CH; lz++) for (let lx=1; lx<=CH; lx++){
    const x=x0-1+lx, z=z0-1+lz; if(!inCore(x,z)) continue;
    for (let ly=0; ly<YR; ly++){
      const t=grid[idx(lx,ly,lz)]; if(t===T.AIR) continue; const y=yMin+ly;
      if (t===T.WATER){ const up=ly+1<YR?grid[idx(lx,ly+1,lz)]:T.AIR; if(up===T.AIR){ faceColor(T.WATER,x,z,0,tmpc);
          for (const v of FACES[0].v){ wpos.push(x+v[0],y+v[1]-0.12,z+v[2]); wnor.push(0,1,0); wcol.push(tmpc[0],tmpc[1],tmpc[2]); } wind.push(wvi,wvi+1,wvi+2,wvi,wvi+2,wvi+3); wvi+=4; } continue; }
      for (let f=0; f<6; f++){ const F=FACES[f]; const nly=ly+F.n[1]; let nt; if(nly<0) nt=T.STONE; else if(nly>=YR) nt=T.AIR; else nt=grid[idx(lx+F.n[0],nly,lz+F.n[2])];
        if (nt!==T.AIR && nt!==T.WATER) continue; faceColor(t,x,z,f,tmpc);
        for (const v of F.v){ pos.push(x+v[0],y+v[1],z+v[2]); nor.push(F.n[0],F.n[1],F.n[2]); colr.push(tmpc[0],tmpc[1],tmpc[2]); }
        ind.push(vi,vi+1,vi+2,vi,vi+2,vi+3); vi+=4; }
    }
  }
  const mk=(p,n,c,i,mat)=>{ if(!i.length) return null; const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3)); g.setAttribute('color',new THREE.Float32BufferAttribute(c,3)); g.setIndex(i); return new THREE.Mesh(g,mat); };
  return {solid:mk(pos,nor,colr,ind,solidMat), water:mk(wpos,wnor,wcol,wind,waterMat)};
}
function disposeChunk(c){ for (const m of [c.solid,c.water]) if(m){ scene.remove(m); m.geometry.dispose(); } }
function setChunk(cx,cz){ const key=cx+','+cz; const old=chunks.get(key); if(old) disposeChunk(old); chunks.delete(key); const c=buildChunk(cx,cz); if(!c) return; if(c.solid) scene.add(c.solid); if(c.water) scene.add(c.water); chunks.set(key,c); }
function markDirty(x,y,z){ const cx=Math.floor(x/CH), cz=Math.floor(z/CH); for (let dz=-1; dz<=1; dz++) for (let dx=-1; dx<=1; dx++) dirty.add((cx+dx)+','+(cz+dz)); }
const queue=[];
function updateChunks(px,pz){
  const pcx=Math.floor(px/CH), pcz=Math.floor(pz/CH);
  for (const [k,c] of chunks){ const [cx,cz]=k.split(',').map(Number); if (Math.max(Math.abs(cx-pcx),Math.abs(cz-pcz))>VIEW_R+2){ disposeChunk(c); chunks.delete(k);} }
  // tiles: request everything the view radius could need (+1 tile margin)
  const bx0=(pcx-VIEW_R-1)*CH, bx1=(pcx+VIEW_R+2)*CH, bz0=(pcz-VIEW_R-1)*CH, bz1=(pcz+VIEW_R+2)*CH;
  for (let tz=Math.max(0,bz0>>8); tz<=Math.min(TY-1,bz1>>8); tz++) for (let tx=Math.max(0,bx0>>8); tx<=Math.min(TX-1,bx1>>8); tx++) requestTile(tx,tz);
  // drop far tiles (keep memory bounded)
  for (const [k,t] of tiles){ if(t.state!=='ready') continue; const [tx,tz]=k.split(',').map(Number); const dx=Math.abs((tx*256+128)-px), dz=Math.abs((tz*256+128)-pz); if (dx>CH*(VIEW_R+8)||dz>CH*(VIEW_R+8)) tiles.delete(k); }
  queue.length=0;
  for (let cz=pcz-VIEW_R; cz<=pcz+VIEW_R; cz++) for (let cx=pcx-VIEW_R; cx<=pcx+VIEW_R; cx++){
    if (cx<0||cz<0||cx*CH>=CW||cz*CH>=CHH) continue; const k=cx+','+cz;
    if (!chunks.has(k)||dirty.has(k)) queue.push([cx,cz,(cx-pcx)**2+(cz-pcz)**2]); }
  queue.sort((a,b)=>a[2]-b[2]);
}
function pumpQueue(budgetMs){
  const t0=performance.now(); let i=0;
  while (i<queue.length && performance.now()-t0<budgetMs){ const [cx,cz]=queue[i];
    if (!tilesReadyFor(cx*CH-1,cz*CH-1,cx*CH+CH,cz*CH+CH)){ i++; continue; }      // wait for tiles, try next
    queue.splice(i,1); setChunk(cx,cz); dirty.delete(cx+','+cz); }
}

// ---------- far terrain meshes -------------------------------------------------------------
const farGroup=new THREE.Group(); scene.add(farGroup); const farMats=[]; const seasonUni={value:new THREE.Vector2(0,0)};
function buildFar(L, texset, skipInsideCore, sink){
  const N=64; // cells per mesh tile
  for (let tz=0; tz<L.H-1; tz+=N) for (let tx=0; tx<L.W-1; tx+=N){
    const nx=Math.min(N, L.W-1-tx), nz=Math.min(N, L.H-1-tz);
    if (skipInsideCore){ const wx0=L.x0+tx*L.cell, wx1=L.x0+(tx+nx)*L.cell, wz0=L.z0+tz*L.cell, wz1=L.z0+(tz+nz)*L.cell;
      if (wx0>=0&&wz0>=0&&wx1<=CW&&wz1<=CHH) continue; }
    const g=new THREE.PlaneGeometry(nx*L.cell, nz*L.cell, nx, nz); g.rotateX(-Math.PI/2);
    const p=g.attributes.position, uv=g.attributes.uv; const c=new Float32Array(p.count*3);
    for (let i=0;i<p.count;i++){ const ix=tx+Math.round((p.getX(i)+nx*L.cell/2)/L.cell), iz=tz+Math.round((p.getZ(i)+nz*L.cell/2)/L.cell);
      const li=iz*L.W+ix; p.setX(i, L.x0+ix*L.cell); p.setZ(i, L.z0+iz*L.cell); p.setY(i, L.h[li]-sink);
      uv.setXY(i, (ix-tx)/nx, 1-(iz-tz)/nz);
      c[i*3]=L.c[li*3]/255; c[i*3+1]=L.c[li*3+1]/255; c[i*3+2]=L.c[li*3+2]/255; }
    g.setAttribute('color',new THREE.BufferAttribute(c,3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const jpg = texset && texset[tx+','+tz];
    let mat;
    if (jpg){ const tex=new THREE.Texture(); tex.anisotropy=renderer.capabilities.getMaxAnisotropy(); tex.minFilter=THREE.LinearMipmapLinearFilter;
      loadImage('data:image/jpeg;base64,'+jpg).then(im=>{ tex.image=im; tex.needsUpdate=true; });
      mat=new THREE.MeshBasicMaterial({map:tex});
      mat.onBeforeCompile=sh=>{ sh.uniforms.uSeason=seasonUni; sh.fragmentShader='uniform vec2 uSeason;\n'+sh.fragmentShader.replace('#include <dithering_fragment>',
        '#include <dithering_fragment>\n float lum=dot(gl_FragColor.rgb,vec3(0.3,0.59,0.11)); vec3 snow=vec3(0.90,0.93,0.98)*(0.75+0.35*lum); gl_FragColor.rgb=mix(gl_FragColor.rgb,snow,uSeason.x);\n vec3 fall=gl_FragColor.rgb*vec3(1.18,0.98,0.72); gl_FragColor.rgb=mix(gl_FragColor.rgb,fall,uSeason.y*smoothstep(0.25,0.55,gl_FragColor.g-gl_FragColor.r+0.35));'); }; }   // the aerial photo already carries the sun's shading
    else mat=new THREE.MeshLambertMaterial({vertexColors:true});
    farMats.push(mat); const m=new THREE.Mesh(g,mat); farGroup.add(m);
  }
}
// trails / roads / streams / boundary as lines riding the far terrain (hidden under blocks where chunks exist)
function buildLines(){
  const add=(polys, color, lift, width)=>{ const pts=[]; for (const pl of polys){ const P=pl.pts||pl; for (let i=0;i<P.length-1;i++){ const a=P[i], b=P[i+1];
      pts.push(a[0],lodH(a[0],a[1])+lift,a[1], b[0],lodH(b[0],b[1])+lift,b[1]); } }
    if (!pts.length) return; const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
    scene.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color, linewidth:width}))); };
  add(META.streams, 0x3f7fc8, 0.8, 1); add(META.roads, 0xd8ccb0, 1.2, 2); add(META.trails, 0xffd27a, 1.2, 2); add(META.boundary, 0xff6a5a, 3, 1);
}

// ---------- labels / signs -----------------------------------------------------------------
// Every named thing in the park gets a label entry {name, cat, x, z, lift}. Sprites are created lazily for the
// nearest visible ones only (a couple of thousand canvases at once would eat the GPU).
const CATS = {
  peaks:  {label:'Peaks',                 color:'#ffe9a8', icon:'▲', range:2600, size:0.062},
  water:  {label:'Ponds & lakes',         color:'#bfe0ff', icon:'●', range:1600, size:0.055},
  streams:{label:'Streams & waterfalls',  color:'#8fd0ff', icon:'≈', range:900,  size:0.045},
  trails: {label:'Trails',                color:'#ffd27a', icon:'—', range:900,  size:0.045},
  roads:  {label:'Roads',                 color:'#e8dcc0', icon:'═', range:900,  size:0.045},
  camps:  {label:'Campgrounds, lean-tos & trailheads', color:'#f4f4f4', icon:'⌂', range:1000, size:0.05},
  terrain:{label:'Ridges, cliffs, viewpoints & places', color:'#d8c8ff', icon:'◆', range:1600, size:0.05},
  photos: {label:'Real photos (markers + side panel)', color:'#ffffff', icon:'📷', range:1200, size:0.03, min:0.4},
};
const KIND2CAT={peak:'peaks',water:'water',waterfall:'streams',spring:'streams',camp_site:'camps',camp_pitch:'camps',shelter:'camps',wilderness_hut:'camps',alpine_hut:'camps',ranger_station:'camps',building:'camps',picnic_site:'camps',trailhead:'camps',parking:'camps',canoe:'camps',information:'camps',terrain:'terrain',place:'terrain',viewpoint:'terrain'};
const labelDefs=[]; const catOn={}; for (const k in CATS) catOn[k]=k!=='roads';
try{ const saved=JSON.parse(localStorage.getItem('bsp_labels')||'null'); if(saved) for (const k in CATS) if (k in saved) catOn[k]=!!saved[k]; }catch(e){}
function buildLabelDefs(){
  for (const L of META.landmarks){ const cat=KIND2CAT[L.kind]; if(!cat) continue; if (/Appalachian National Scenic Trailhead/i.test(L.name)) continue; labelDefs.push({name:L.name, cat, x:L.x, z:L.y, lift: L.kind==='peak'?5:4, L}); }
  // linear features: one label per ~spacing of length, deduped by name
  const placed=[];
  const addLinear=(list, cat, spacing)=>{
    for (const f of list){ if(!f.name) continue; const P=f.pts; if(P.length<2) continue;
      let len=0; const cum=[0]; for (let i=1;i<P.length;i++){ len+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]); cum.push(len); }
      if (len<40) continue;
      const targets=[]; if (len<spacing*1.5) targets.push(len/2); else for (let d=spacing/2; d<len; d+=spacing) targets.push(d);
      for (const t of targets){ let i=1; while (i<cum.length-1 && cum[i]<t) i++; const a=P[i-1], b=P[i]; const u=(t-cum[i-1])/Math.max(1e-6,cum[i]-cum[i-1]); const x=a[0]+(b[0]-a[0])*u, z=a[1]+(b[1]-a[1])*u;
        if (placed.some(q=>q.name===f.name && Math.hypot(q.x-x,q.z-z)<spacing*0.7)) continue;
        const d={name:f.name, cat, x, z, lift:3}; placed.push(d); labelDefs.push(d); } }
  };
  addLinear(META.trails,'trails',450); addLinear(META.streams.filter(s=>s.kind!=='flowline'),'streams',600); addLinear(META.roads,'roads',800);
  // real photos: one marker per cluster of photo locations
  const clusters=[]; for (const ph of PHOTOS_ALL){ let c=clusters.find(q=>Math.hypot(q.x-ph.x,q.z-ph.z)<8); if(!c){ c={x:ph.x,z:ph.z,n:0,items:[]}; clusters.push(c);} c.n++; c.items.push(ph); }
  for (const c of clusters) labelDefs.push({name:c.n>1?String(c.n):'', cat:'photos', x:c.x, z:c.z, lift:2.5, cluster:c});
}
const spriteCache=new Map();   // def -> sprite
function spriteFor(d){
  let s=spriteCache.get(d); if (s) return s;
  const C=CATS[d.cat]; const text=C.icon+' '+d.name;
  const c=document.createElement('canvas'); c.width=512; c.height=64; const g=c.getContext('2d');
  g.font='bold 30px ui-monospace, Menlo, monospace'; g.textAlign='center'; g.textBaseline='middle';
  let w=g.measureText(text).width; if (w>490){ g.font='bold 24px ui-monospace, Menlo, monospace'; }
  g.lineWidth=6; g.strokeStyle='rgba(0,0,0,0.85)'; g.strokeText(text,256,32); g.fillStyle=C.color; g.fillText(text,256,32);
  s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:true,depthWrite:false,transparent:true})); s.center.set(0.5,0); s.userData.def=d;   // depth-tested: blocks, cairns, signs and the far terrain hide labels behind them s.userData.last=0;
  scene.add(s); spriteCache.set(d,s); return s;
}
let labelTick=0;
function updateLabels(){
  labelTick++;
  const agl=Math.max(0, player.y-lodH(player.x,player.z)); const f=1+agl/150;           // higher up → see farther labels
  const cands=[];
  for (const d of labelDefs){ if(!catOn[d.cat]) continue; const dist=Math.hypot(d.x-player.x, d.z-player.z); const R=CATS[d.cat].range*f; if (dist<R && dist>4) cands.push([dist,d]); }
  cands.sort((a,b)=>a[0]-b[0]);
  // line of sight: drop labels hidden behind terrain (sampled against the smooth height field)
  const cx=camera.position.x, cy=camera.position.y, cz=camera.position.z; const show=[];
  const recheck=(labelTick&3)===0;
  for (const c of cands){ if (show.length>=90) break; const d=c[1]; if (!recheck){ if (d.vis) show.push(c); continue; } const tx=d.x, tz=d.z, ty=hAt(Math.round(tx),Math.round(tz))+d.lift+0.5;
    // march from 2 blocks in front of the camera to the label; real block heights where tiles are loaded, smooth terrain beyond
    const len=Math.hypot(tx-cx, ty-cy, tz-cz); const n=Math.min(220, Math.max(12, Math.floor(len/4))); let hidden=false; const t0=Math.min(0.5, 2/len);
    for (let i=1;i<n;i++){ const t=i/n; if (t<t0) continue; const x=cx+(tx-cx)*t, z=cz+(tz-cz)*t, y=cy+(ty-cy)*t;
      const xi=Math.floor(x), zi=Math.floor(z); const tl=inCore(xi,zi)?tileOf(xi,zi):null; const h=(tl&&tl.state==='ready') ? tl.h[((zi&255)<<8)|(xi&255)]+1 : lodH(x,z)-1;
      if (h > y){ hidden=true; break; } }
    d.vis=!hidden; if (!hidden) show.push(c); }
  const keep=new Set();
  for (const [dist,d] of show){ const s=spriteFor(d); keep.add(s); s.visible=true; s.userData.last=labelTick;
    const x=Math.round(d.x), z=Math.round(d.z); const tt=tAt(x,z); s.position.set(d.x, hAt(x,z)+d.lift+((tt===T.FOREST||tt===T.BOG)?5:0), d.z);
    const k=Math.min(Math.max(CATS[d.cat].min||0.7, camera.position.distanceTo(s.position)*CATS[d.cat].size), 400); s.scale.set(k*8, k, 1); }
  for (const [d,s] of spriteCache){ if (!keep.has(s)){ s.visible=false; if (labelTick-s.userData.last>600){ scene.remove(s); s.material.map.dispose(); s.material.dispose(); spriteCache.delete(d); } } }
}
// toggle panel (N)
const lpanel=document.getElementById('labels'); let lpanelOpen=false;
function buildLabelPanel(){
  let html='<h3>Labels <span style="opacity:.6;font-weight:400;font-size:12px">(N to close)</span></h3>';
  for (const k in CATS) html+=`<label><input type="checkbox" data-k="${k}" ${catOn[k]?'checked':''}> <span style="color:${CATS[k].color}">${CATS[k].icon}</span> ${CATS[k].label}</label>`;
  html+='<p>Labels appear within a distance that grows as you fly higher. The 90 nearest are shown.</p>';
  lpanel.innerHTML=html;
  lpanel.querySelectorAll('input').forEach(i=>i.onchange=()=>{ catOn[i.dataset.k]=i.checked; try{localStorage.setItem('bsp_labels',JSON.stringify(catOn));}catch(e){} });
}
function toggleLabelPanel(v){ lpanelOpen=v===undefined?!lpanelOpen:v; lpanel.style.display=lpanelOpen?'block':'none'; if(lpanelOpen) document.exitPointerLock(); else canvas.requestPointerLock(); }
// Back of the Baxter Peak sign: a small note from the people who built this, with a QR code to steadystatehealth.com
const EGG_URL='https://www.steadystatehealth.com';
const QR=['1fd7d47f','104ce341','17444d5d','175e055d','17570c5d','105c1641','1fd5557f','0011b800','11748bf9','1f85d4ff','1ed81cf1','01bf4d1b','0ef2ea82','179604df','0674e95d','0431aec3','13edaaa2','16b5fc7b','066c2d55','052b4843','1c79e9f9','001f3111','1fdaef5d','104a9b11','17558bf8','17447fa1','174b7a8f','104c89db','1fd7edb2'];
let eggSign=null;
function nearEgg(){ if(!eggSign) return false; const dx=eggSign.x-player.x, dz=eggSign.z-player.z; return Math.hypot(dx,dz)<7 && Math.abs(player.y-(hAt(Math.floor(eggSign.x),Math.floor(eggSign.z))))<6; }
// The real Baxter Peak sign as it stands today: dark weathered board, white routed hand lettering, two grey posts
const SIGN_FONT='"Futura", "Avenir Next Condensed", "Gill Sans", "Trebuchet MS", "Arial Narrow", sans-serif';
function woodBoard(g,W,H){
  g.fillStyle='#4a3626'; g.fillRect(0,0,W,H);
  for (let i=0;i<260;i++){ const y=Math.random()*H, x=Math.random()*W, l=40+Math.random()*300; g.strokeStyle=`rgba(${Math.random()<0.5?20:90},${Math.random()<0.5?12:64},${Math.random()<0.5?8:44},${0.08+Math.random()*0.18})`; g.lineWidth=1+Math.random()*2; g.beginPath(); g.moveTo(x,y); g.lineTo(x+l,y+(Math.random()-0.5)*3); g.stroke(); }
  for (let i=0;i<900;i++){ g.fillStyle=`rgba(${120+Math.random()*80},${100+Math.random()*60},${80+Math.random()*40},${Math.random()*0.10})`; g.fillRect(Math.random()*W,Math.random()*H,2+Math.random()*3,1+Math.random()*2); }
  g.strokeStyle='rgba(0,0,0,0.45)'; g.lineWidth=3; for (const y of [H*0.36,H*0.62]){ g.beginPath(); g.moveTo(0,y); g.lineTo(W,y); g.stroke(); }
  for (const [bx,by] of [[34,44],[W-34,44],[34,H-40],[W-34,H-40],[34,H*0.5],[W-34,H*0.5]]){ g.fillStyle='#7a7f7a'; g.beginPath(); g.arc(bx,by,7,0,Math.PI*2); g.fill(); g.fillStyle='#4a4d4a'; g.beginPath(); g.arc(bx+2,by+2,3,0,Math.PI*2); g.fill(); }
}
function routed(g,text,x,y,size,align,weight){ g.font=(weight||'500')+' '+size+'px '+SIGN_FONT; g.textAlign=align||'center'; g.textBaseline='middle'; try{ g.letterSpacing=Math.round(size*0.08)+'px'; }catch(e){}
  g.fillStyle='rgba(0,0,0,0.35)'; g.fillText(text,x+2,y+2); g.fillStyle='#f2efe6'; g.fillText(text,x,y); }
function baxterSignFront(c){
  c.width=1024; c.height=800; const W=1024,H=800; const g=c.getContext('2d'); woodBoard(g,W,H);
  routed(g,'KATAHDIN',W/2,110,150,'center','500');
  routed(g,'BAXTER PEAK',W*0.30,222,40,'center'); routed(g,'ELEVATION 5267 FT.',W*0.68,222,40,'center');
  routed(g,'NORTHERN TERMINUS OF THE',W/2,300,42,'center'); routed(g,'APPALACHIAN TRAIL',W/2,352,46,'center');
  const rows=[['→','PAMOLA PEAK via KNIFE EDGE','1.1 MI.'],['↑','CHIMNEY POND CAMPGROUND via SADDLE','2.2'],['↑','ROARING BROOK CAMPGROUND via SADDLE','5.5'],['←','KATAHDIN STREAM CAMPGROUND','5.2'],['←','ABOL CAMPGROUND','4.4'],['←','SPRINGER MOUNTAIN, GEORGIA via the A.T.','2,189.1']];
  let y=430; for (const [a,n,d] of rows){ routed(g,a,112,y,30,'center'); routed(g,n,140,y,29,'left'); routed(g,d,W-96,y,29,'right'); y+=44; }
  routed(g,'BAXTER STATE PARK',W/2,H-52,32,'center');
}
function signBackCanvas(){
  const c=document.createElement('canvas'); c.width=1024; c.height=800; const W=1024,H=800; const g=c.getContext('2d'); woodBoard(g,W,H);
  const N=QR.length, cell=9, size=N*cell, qx=W-72-size, qy=H/2-size/2+60;
  g.fillStyle='#f2efe6'; g.fillRect(qx-18,qy-18,size+36,size+36); g.fillStyle='#2a1a0c';
  for (let r=0;r<N;r++){ const bits=parseInt(QR[r],16); for (let k=0;k<N;k++) if (bits & (1<<(N-1-k))) g.fillRect(qx+k*cell, qy+r*cell, cell, cell); }
  routed(g,'BUILT BY',W/2,96,56,'center'); routed(g,'STEADY STATE',W/2,170,84,'center');
  const tx=100, tw=qx-18-tx-36; g.font='400 30px '+SIGN_FONT; try{ g.letterSpacing='1px'; }catch(e){}
  const wrap=(t,y,lh)=>{ const words=t.split(' '); let line=''; for (const w of words){ const test=line?line+' '+w:w; g.font='400 30px '+SIGN_FONT; if (g.measureText(test).width>tw && line){ routed(g,line,tx,y,30,'left','400'); y+=lh; line=w; } else line=test; } if (line){ routed(g,line,tx,y,30,'left','400'); y+=lh; } return y; };
  let y=wrap('If you’re exploring this world because you have an injury and can’t go here in real life, the physical therapists at Steady State can help.',260,40);
  routed(g,'steadystatehealth.com',tx,y+34,38,'left','500'); routed(g,'PORTLAND, MAINE \u00b7 SCAN, OR PRESS O',tx,y+90,22,'left','400');
  return c;
}
function makeSign(L,x,z){
  const h=hAt(x,z); signposts.set(x+','+z,L);
  const ft=L.ele?Math.round(+L.ele*3.28084):Math.round((h*BLOCK_M+BASE_M)*3.28084);
  const lines=[L.name.toUpperCase(),'ELEV. '+ft.toLocaleString()+' FT'];
  if (/baxter/i.test(L.name)) lines.push('NORTHERN TERMINUS OF THE','APPALACHIAN TRAIL');
  if (/pamola/i.test(L.name)) lines.push('KNIFE EDGE  1.1 MI  →  BAXTER PEAK');
  const c=document.createElement('canvas'); c.width=1024; c.height=512; const g=c.getContext('2d');
  g.fillStyle='#5a3d22'; g.fillRect(0,0,1024,512); g.fillStyle='#4a3019'; for(let i=0;i<8;i++) g.fillRect(0,i*64+58,1024,6);
  g.strokeStyle='#e8d8b0'; g.lineWidth=10; g.strokeRect(24,24,976,464); g.fillStyle='#f3e7c6'; g.textAlign='center'; g.textBaseline='middle';
  const sizes=[86,64,44,44]; let y=120; lines.forEach((t,i)=>{ g.font='bold '+(sizes[i]||44)+'px ui-monospace, Menlo, monospace'; g.fillText(t,512,y); y+=i===0?110:(i===1?95:60); });
  const isBax=/baxter/i.test(L.name); if (isBax) baxterSignFront(c);
  const mat=new THREE.MeshLambertMaterial({map:new THREE.CanvasTexture(c)}); const grp=new THREE.Group();
  if (!isBax){
    grp.position.set(x+0.5,h+2.7,z+0.5);
    const f=new THREE.Mesh(new THREE.PlaneGeometry(2.6,1.3),mat); f.position.z=0.03; grp.add(f);
    const bk=new THREE.Mesh(new THREE.PlaneGeometry(2.6,1.3),mat); bk.position.z=-0.03; bk.rotation.y=Math.PI; grp.add(bk);
  } else {
    // A-frame like the real summit sign: two pairs of grey legs meeting above the board, a top rail, board hung on the front legs
    const SW=2.8, SH=2.2, yb=1.15, yc=yb+SH/2, apex=yb+SH+0.55, d=0.6;        // heights above the summit surface (h+1); the rock-pile block occupies 0..1
    grp.position.set(x+0.5,h+1,z+0.5);
    const legLen=Math.hypot(apex,d), a=Math.atan2(d,apex); const pm=new THREE.MeshLambertMaterial({color:0x9a9488});
    for (const sx of [-1,1]) for (const sz of [-1,1]){ const leg=new THREE.Mesh(new THREE.BoxGeometry(0.16,legLen,0.16),pm); leg.position.set(sx*(SW/2+0.02), apex/2, sz*d/2); leg.rotation.x=-sz*a; grp.add(leg); }
    const rail=new THREE.Mesh(new THREE.BoxGeometry(SW+0.36,0.14,0.16),pm); rail.position.set(0,apex-0.05,0); grp.add(rail);
    const zc=d*(apex-yc)/apex;                                                       // where the front legs are at board height
    const board=new THREE.Group(); board.position.set(0,yc,zc+0.06); board.rotation.x=-a; grp.add(board);   // leans back with the front legs
    const f=new THREE.Mesh(new THREE.PlaneGeometry(SW,SH),mat); f.position.z=0.04; board.add(f);
    const bmat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(signBackCanvas())});   // unlit so the note reads even though the north face is in shade
    const bk=new THREE.Mesh(new THREE.PlaneGeometry(SW,SH),bmat); bk.position.z=-0.04; bk.rotation.y=Math.PI; board.add(bk);
  }
  if (/baxter/i.test(L.name)) eggSign={x:x+0.5, z:z+0.5, grp};
  const dirs=[[1,0],[-1,0],[0,1],[0,-1]]; let best=dirs[0],bh=1e9; for (const d of dirs){ const hh=hAt(x+d[0]*4,z+d[1]*4); if(hh<bh){bh=hh;best=d;} }
  if (/baxter/i.test(L.name)) best=[0,1];   // the real sign faces south: reading the 'Northern Terminus' side you look north, with Hamlin Peak behind it; the note is on its back
  grp.rotation.y=Math.atan2(best[0],best[1]); scene.add(grp);
  if (!isBax){ const post=new THREE.Mesh(new THREE.BoxGeometry(0.16,2.1,0.16),new THREE.MeshLambertMaterial({color:0x6a4a2a})); post.position.set(x+0.5,h+1.0,z+0.5); scene.add(post); }
}

// ---------- player ---------------------------------------------------------------------------
const player={x:0,y:0,z:0,vx:0,vy:0,vz:0,yaw:0,pitch:0,onGround:false,fly:false,hot:0};
const HW=0.3,PH=1.8,EYE=1.62; const keys={}; let lastSpace=0, lastShift=0;
function collides(x,y,z){
  const x0=Math.floor(x-HW),x1=Math.floor(x+HW),z0=Math.floor(z-HW),z1=Math.floor(z+HW),y0=Math.floor(y),y1=Math.floor(y+PH-0.001);
  for (let yy=y0;yy<=y1;yy++) for (let zz=z0;zz<=z1;zz++) for (let xx=x0;xx<=x1;xx++) if (solid(xx,yy,zz)) return true;
  return false;
}
function groundHere(){ // smooth ground outside the block world
  return lodH(player.x,player.z);
}
function inWater(){ return typeAt(Math.floor(player.x),Math.floor(player.y+0.5),Math.floor(player.z))===T.WATER; }
function placeOnTop(x,z){ player.x=x+0.5; player.z=z+0.5; let y=hAt(x,z)+1; if (inCore(x,z)) while (collides(player.x,y,player.z)) y++; else y=lodH(player.x,player.z)+0.5; player.y=y; player.vx=player.vy=player.vz=0; }
function step(dt){
  let sp;
  if (player.fly){ const agl=Math.max(0, player.y-lodH(player.x,player.z));          // blocks above the terrain
    const base=18*(1+agl/120);                                                          // 18 b/s at ground, ~2x at 360 m up, ~5x at 1.5 km up
    sp=Math.min(base, 400); }
  else sp=(keys.ShiftLeft||keys.ShiftRight)?6.2:4.3;
  const fx=-Math.sin(player.yaw), fz=-Math.cos(player.yaw), rx=-fz, rz=fx; let mx=0,mz=0;
  if (keys.KeyW){mx+=fx;mz+=fz;} if (keys.KeyS){mx-=fx;mz-=fz;} if (keys.KeyD){mx+=rx;mz+=rz;} if (keys.KeyA){mx-=rx;mz-=rz;}
  const l=Math.hypot(mx,mz); if(l>0){mx/=l;mz/=l;}
  const blocky = inCore(Math.floor(player.x),Math.floor(player.z)) && (()=>{ const tl=tileOf(Math.floor(player.x),Math.floor(player.z)); return tl&&tl.state==='ready'; })();
  const water=blocky&&inWater();
  if (player.fly){ const vs=Math.min(60, 14+sp*0.35); player.vx=mx*sp; player.vz=mz*sp; player.vy=(keys.Space?vs:0)-((keys.ShiftLeft||keys.ShiftRight)?vs:0); }
  else { const accel=player.onGround?40:12; player.vx+=(mx*sp-player.vx)*Math.min(1,accel*dt); player.vz+=(mz*sp-player.vz)*Math.min(1,accel*dt);
    if (water){ player.vy+=(-3-player.vy)*Math.min(1,4*dt); if(keys.Space) player.vy=4; player.vx*=0.9; player.vz*=0.9; }
    else { player.vy-=28*dt; if(keys.Space&&player.onGround){player.vy=11.3;player.onGround=false;} } if(player.vy<-60)player.vy=-60; }
  if (blocky){
    let nx=player.x+player.vx*dt;
    if (collides(nx,player.y,player.z)){ if(!player.fly&&(player.onGround||water)&&!collides(nx,player.y+1,player.z)&&!collides(player.x,player.y+1,player.z)) player.y+=1; else {nx=player.x;player.vx=0;} }
    player.x=nx; let nz=player.z+player.vz*dt;
    if (collides(player.x,player.y,nz)){ if(!player.fly&&(player.onGround||water)&&!collides(player.x,player.y+1,nz)&&!collides(player.x,player.y+1,player.z)) player.y+=1; else {nz=player.z;player.vz=0;} }
    player.z=nz; let ny=player.y+player.vy*dt; player.onGround=false;
    if (collides(player.x,ny,player.z)){ if(player.vy<0){ny=Math.floor(ny)+1;player.onGround=true;} else ny=Math.floor(ny+PH)-PH-0.001; player.vy=0; }
    player.y=ny;
  } else {                                  // smooth terrain outside the detailed core
    player.x+=player.vx*dt; player.z+=player.vz*dt; player.y+=player.vy*dt; player.onGround=false;
    const gnd=groundHere(); if (player.y<gnd){ player.y=gnd; if(player.vy<0)player.vy=0; player.onGround=true; }
  }
  if (player.y<-50) placeOnTop(Math.floor(player.x),Math.floor(player.z));
}

// ---------- raycast / edit ------------------------------------------------------------------
function raycast(maxD){
  const ox=player.x,oy=player.y+EYE,oz=player.z; const dx=-Math.sin(player.yaw)*Math.cos(player.pitch),dy=Math.sin(player.pitch),dz=-Math.cos(player.yaw)*Math.cos(player.pitch);
  let x=Math.floor(ox),y=Math.floor(oy),z=Math.floor(oz); const sx=Math.sign(dx),sy=Math.sign(dy),sz=Math.sign(dz); const tdx=Math.abs(1/dx),tdy=Math.abs(1/dy),tdz=Math.abs(1/dz);
  let tmx=dx>0?(x+1-ox)*tdx:(ox-x)*tdx, tmy=dy>0?(y+1-oy)*tdy:(oy-y)*tdy, tmz=dz>0?(z+1-oz)*tdz:(oz-z)*tdz; let face=[0,0,0],t=0;
  for (let i=0;i<maxD*3;i++){ const tt=typeAt(x,y,z); if(tt!==T.AIR) return {x,y,z,type:tt,face};
    if (tmx<tmy&&tmx<tmz){x+=sx;t=tmx;tmx+=tdx;face=[-sx,0,0];} else if(tmy<tmz){y+=sy;t=tmy;tmy+=tdy;face=[0,-sy,0];} else {z+=sz;t=tmz;tmz+=tdz;face=[0,0,-sz];} if(t>maxD)break; }
  return null;
}
function setBlock(x,y,z,t){ if(!inCore(x,z)) return; const k=x+','+y+','+z; const e=edits.get(k); edits.delete(k); const nat=typeAt(x,y,z); if (nat===t) edits.delete(k); else edits.set(k,t); markDirty(x,y,z); updateChunks(player.x,player.z); }

// ---------- minimap ------------------------------------------------------------------------
const mapC=document.getElementById('map'), mg=mapC.getContext('2d'); let mapZoom=0; const ZOOMS=[1.6,3.2,0.8,0.3,0.12]; let miniImg=null, MINI=null;
function drawMap(){
  const S=220, scale=ZOOMS[mapZoom%ZOOMS.length]; const half=S/scale/2, cx=player.x, cz=player.z;
  mg.fillStyle='#0a1a2a'; mg.fillRect(0,0,S,S); mg.imageSmoothingEnabled = true;
  if (miniImg){ const sx=(cx-half-MINI.x0)/MINI.cell, sz=(cz-half-MINI.z0)/MINI.cell, sw=half*2/MINI.cell; mg.drawImage(miniImg,sx,sz,sw,sw,0,0,S,S); }
  mg.fillStyle='rgba(0,0,0,0.15)'; mg.fillRect(0,0,S,S);
  const toS=(x,z)=>[(x-cx)*scale+S/2,(z-cz)*scale+S/2];
  const poly=(list,color,w)=>{ mg.lineWidth=w; mg.strokeStyle=color; for (const tr of list){ const P=tr.pts||tr; mg.beginPath(); let started=false; for (const p of P){ const [sx,sz]=toS(p[0],p[1]); if(sx<-50||sz<-50||sx>S+50||sz>S+50){ started=false; continue;} if(!started){mg.moveTo(sx,sz);started=true;} else mg.lineTo(sx,sz);} mg.stroke(); } };
  if (scale>=0.3) poly(META.streams,'rgba(90,160,240,0.7)',1);
  poly(META.roads,'rgba(240,230,200,0.9)',scale>=0.8?2:1); poly(META.trails,'rgba(255,215,120,0.95)',scale>=0.8?1.6:1); poly(META.boundary,'rgba(255,110,90,0.9)',1.5);
  mg.font='10px ui-monospace,monospace'; mg.textAlign='center';
  for (const L of META.landmarks){ if (scale<0.8 && L.kind!=='peak' && L.kind!=='water' && L.kind!=='camp_site') continue; if (scale<0.3 && L.kind!=='peak') continue;
    const [sx,sz]=toS(L.x,L.y); if(sx<-40||sz<-10||sx>S+40||sz>S+10) continue;
    mg.fillStyle=L.kind==='peak'?'#ffe9a8':(L.kind==='water'?'#9fd0ff':'#fff'); mg.beginPath(); mg.arc(sx,sz,2.2,0,7); mg.fill();
    mg.fillStyle='rgba(0,0,0,.75)'; mg.fillText(L.name,sx,sz-6); mg.fillStyle=L.kind==='peak'?'#ffe9a8':'#fff'; mg.fillText(L.name,sx,sz-7); }
  mg.save(); mg.translate(S/2,S/2); mg.rotate(-player.yaw); mg.fillStyle='#ff5a3c'; mg.beginPath(); mg.moveTo(0,-8); mg.lineTo(5,6); mg.lineTo(0,3); mg.lineTo(-5,6); mg.closePath(); mg.fill(); mg.restore();
}

// ---------- HUD / geodesy ----------------------------------------------------------------------
const hud=document.getElementById('hud'), hot=document.getElementById('hot'), compassEl=document.getElementById('compass');
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function heading(){ let d=(-player.yaw*180/Math.PI)%360; if(d<0)d+=360; return d; } const flashEl=document.getElementById('flash'); let flashT=0;
function flash(msg){ flashEl.textContent=msg; flashEl.style.opacity=1; flashT=performance.now(); }
function buildHotbar(){ hot.innerHTML=''; HOTBAR.forEach((h,i)=>{ const d=document.createElement('div'); d.className='slot'+(i===player.hot?' sel':''); const c=BASECOL[h.t]; d.innerHTML=`<div><i style="background:rgb(${c[0]},${c[1]},${c[2]})"></i>${i+1}</div>`; d.title=h.n; hot.appendChild(d); }); }
function latLonToUtm(lat,lon){ // WGS84 -> UTM 19N
  const a=6378137, f=1/298.257223563, k0=0.9996, e2=f*(2-f), ep2=e2/(1-e2), lon0=-69*Math.PI/180; const phi=lat*Math.PI/180, lam=lon*Math.PI/180;
  const N=a/Math.sqrt(1-e2*Math.sin(phi)**2), T=Math.tan(phi)**2, C=ep2*Math.cos(phi)**2, A=Math.cos(phi)*(lam-lon0);
  const M=a*((1-e2/4-3*e2*e2/64-5*e2**3/256)*phi-(3*e2/8+3*e2*e2/32+45*e2**3/1024)*Math.sin(2*phi)+(15*e2*e2/256+45*e2**3/1024)*Math.sin(4*phi)-(35*e2**3/3072)*Math.sin(6*phi));
  const E=500000+k0*N*(A+(1-T+C)*A**3/6+(5-18*T+T*T+72*C-58*ep2)*A**5/120);
  const Nn=k0*(M+N*Math.tan(phi)*(A*A/2+(5-T+9*C+4*C*C)*A**4/24+(61-58*T+T*T+600*C-330*ep2)*A**6/720));
  return [E,Nn];
}
function utmToLatLon(E,N){ // WGS84 / UTM zone 19N inverse
  const a=6378137, f=1/298.257223563, k0=0.9996, e2=f*(2-f), ep2=e2/(1-e2), lon0=(-69)*Math.PI/180;
  const x=E-500000, y=N; const M=y/k0; const mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu);
  const N1=a/Math.sqrt(1-e2*Math.sin(phi1)**2), T1=Math.tan(phi1)**2, C1=ep2*Math.cos(phi1)**2, R1=a*(1-e2)/Math.pow(1-e2*Math.sin(phi1)**2,1.5), D=x/(N1*k0);
  const lat=phi1-(N1*Math.tan(phi1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/Math.cos(phi1);
  return [lat*180/Math.PI, lon*180/Math.PI];
}
function lonlat(){ return utmToLatLon(META.utm.e0+player.x*BLOCK_M, META.utm.n1-player.z*BLOCK_M); }
let fps=0,fcount=0,ftime=0;
function updateHUD(){
  const elev=player.y*BLOCK_M+BASE_M; const [lat,lon]=lonlat();
  let near=null,nd=1e9; for (const L of META.landmarks){ const d=Math.hypot(L.x-player.x,L.y-player.z)*BLOCK_M; if(d<nd){nd=d;near=L;} }
  const hh=Math.floor(dayT*24), mm=Math.floor((dayT*24-hh)*60);
  const px=Math.floor(player.x), pz=Math.floor(player.z); const under=tAt(px,pz); let onTrail='';
  if (under===T.TRAIL||under===T.ROAD){ let best=null,bd=1e9; for (const tr of (under===T.ROAD?META.roads:META.trails)) for (const p of tr.pts){ const d=(p[0]-player.x)**2+(p[1]-player.z)**2; if(d<bd){bd=d;best=tr;} } onTrail=best&&best.name?'  ·  on '+best.name:'  ·  on '+(under===T.ROAD?'road':'trail'); }
  const zone = inCore(px,pz) ? '' : '  ·  outside the 3 m core (smooth terrain)';
  hud.innerHTML=`<b>${elev.toFixed(0)} m</b>  (${(elev*3.28084).toFixed(0)} ft)\n${lat.toFixed(5)}, ${lon.toFixed(5)}\n${near?near.name+'  '+(nd<1000?nd.toFixed(0)+' m':(nd/1000).toFixed(2)+' km'):''}\n${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}  ${player.fly?'flying':'walking'}${onTrail}${zone}  ·  ${season} (Y)  ${fps} fps\n${hoverText?'<span style="color:#ffd27a">'+hoverText+'</span>\n':''}${nearEgg()?'<span style="color:#ffd77a">O: open steadystatehealth.com</span>\n':''}<span style="opacity:.6">${HOTBAR[player.hot].n} selected · blocks to ${(VIEW_R*CH*BLOCK_M/1000).toFixed(1)} km (−/=) · ${chunks.size} chunks · ${[...tiles.values()].filter(t=>t.state==='ready').length} tiles</span>`;
}

// ---------- sky ------------------------------------------------------------------------------
let dayT=0.34; const skyDay=new THREE.Color(0x8fbfe8),skyDusk=new THREE.Color(0xe08a5a),skyNight=new THREE.Color(0x0a1022),fogDay=new THREE.Color(0xd6e6f7),fogNight=new THREE.Color(0x0e1626);
function updateSky(){
  const a=dayT*Math.PI*2-Math.PI/2, sunEl=Math.sin(a);
  sun.position.set(player.x-Math.sin(dayT*Math.PI*2+Math.PI)*300, player.y+Math.max(-40,sunEl*300), player.z+Math.cos(dayT*Math.PI*2+Math.PI)*120);   // rises in the east (+x), stands south (+z) at noon, sets in the west
  sun.target.position.set(player.x,player.y,player.z); sun.target.updateMatrixWorld();
  const day=Math.max(0,Math.min(1,(sunEl+0.08)/0.35)), dusk=Math.max(0,1-Math.abs(sunEl)/0.18);
  const zen=skyNight.clone().lerp(new THREE.Color(0x2f6fc8),day); const hor=fogNight.clone().lerp(fogDay,day).lerp(skyDusk,dusk*0.55);
  skyUni.top.value.copy(zen); skyUni.horizon.value.copy(hor); skyUni.night.value=1-day;
  skyUni.sunDir.value.set(Math.sin(dayT*Math.PI*2+Math.PI), sunEl, -Math.cos(dayT*Math.PI*2+Math.PI)).normalize();
  skyUni.sunCol.value.setRGB(1,0.9-0.25*dusk,0.75-0.45*dusk); sky.position.set(player.x,player.y,player.z);
  scene.background=null; scene.fog.color.copy(hor);
  const tint=0.22+0.78*day; for (const m of farMats) m.color.setRGB(tint, tint*(0.97+0.03*day), tint*(0.93+0.07*day));
  seasonUni.value.set(season==='winter'?0.85:(season==='spring'?0.12:0), season==='fall'?0.85:0);
  sun.intensity=0.10+0.60*day; sun.color.setRGB(1,0.92+0.08*(1-dusk),0.8+0.2*(1-dusk)); hemi.intensity=0.08+0.26*day;
  const flyHigh = Math.max(0, player.y - lodH(player.x,player.z));
  scene.fog.density = (0.00009 - 0.00003*day) / (1 + flyHigh/400);          // haze; thinner when you climb
}

// ---------- landmark list overlay ------------------------------------------------------------
const list=document.getElementById('list'); let listOpen=false;
const KIND_LABEL={peak:'Peaks',water:'Ponds, lakes & bays',camp_site:'Campgrounds',camp_pitch:'Campsites',wilderness_hut:'Cabins & huts',alpine_hut:'Cabins & huts',shelter:'Lean-tos & shelters',ranger_station:'Ranger stations',building:'Buildings',viewpoint:'Viewpoints',parking:'Trailhead parking',trailhead:'Trailheads',place:'Places',information:'Information',picnic_site:'Picnic sites',waterfall:'Waterfalls & rapids',spring:'Springs',terrain:'Ridges, cliffs & landforms',canoe:'Canoe rentals & launches'};
function buildList(){
  const groups={}; for (const L of META.landmarks){ const k=KIND_LABEL[L.kind]||'Other'; (groups[k]=groups[k]||[]).push(L); }
  const order=['Peaks','Ponds, lakes & bays','Waterfalls & rapids','Ridges, cliffs & landforms','Campgrounds','Lean-tos & shelters','Cabins & huts','Ranger stations','Trailheads','Trailhead parking','Canoe rentals & launches','Viewpoints','Buildings','Campsites','Places','Picnic sites','Springs','Information','Other'];
  let html='<h3>Teleport to… <span style="opacity:.6;font-weight:400;font-size:12px">(L or Esc to close)</span></h3><div class="cols">';
  for (const k of order){ if(!groups[k]) continue; html+=`<div class="grp"><h4>${k} <span>${groups[k].length}</span></h4>`; for (const L of groups[k].sort((a,b)=>a.name.localeCompare(b.name))){ const i=META.landmarks.indexOf(L); html+=`<a data-i="${i}">${L.name}${L.ele?' <em>'+Math.round(L.ele*3.28084).toLocaleString()+' ft</em>':''}</a>`; } html+='</div>'; }
  list.innerHTML=html+'</div>';
  list.querySelectorAll('a').forEach(a=>a.onclick=()=>{ const L=META.landmarks[+a.dataset.i]; goTo(L); toggleList(false); canvas.requestPointerLock(); });
}
function toggleList(v){ listOpen=v===undefined?!listOpen:v; list.style.display=listOpen?'block':'none'; if(listOpen) document.exitPointerLock(); }
function goTo(L){ const x=Math.round(L.x), z=Math.round(L.y); player.x=x+0.5; player.z=z+0.5; player.y=lodH(player.x,player.z)+8; player.fly=true; player.pitch=-0.35; player.vx=player.vy=player.vz=0; updateChunks(player.x,player.z); pendingSnap={x,z,tries:0,hover:true}; }
function highestNear(x,z,r){ let bh=-1,bx=x,bz=z; for (let dx=-r;dx<=r;dx++) for (let dz=-r;dz<=r;dz++){ const hh=hAt(x+dx,z+dz); if (hh>bh){ bh=hh; bx=x+dx; bz=z+dz; } } return [bx,bz]; }
let pendingSnap=null;   // after teleport, snap onto blocks once tiles have arrived
const signsPending=META.landmarks.filter(L=>L.kind==='peak' && /^(Baxter Peak|Pamola)$/i.test(L.name));

// ---------- trail graph, hover distances and route planner ----------------------------------------
const MI=1609.344/BLOCK_M;                                   // blocks per mile
const graph={nodes:[], nodeAt:new Map(), edges:[], grid:new Map()};
const gkey=(x,z)=>((x/64)|0)+','+((z/64)|0);
function nodeId(x,z){ const k=Math.round(x)+','+Math.round(z); let id=graph.nodeAt.get(k); if (id===undefined){ id=graph.nodes.length; graph.nodes.push({x,z,edges:[],name:null}); graph.nodeAt.set(k,id); } return id; }
function buildGraph(){
  const ways=[...META.trails.map(t=>({...t,road:false})), ...META.roads.map(t=>({...t,road:true}))];
  // count vertex sharing to find junctions
  const count=new Map(); for (const w of ways) for (const p of w.pts){ const k=Math.round(p[0])+','+Math.round(p[1]); count.set(k,(count.get(k)||0)+1); }
  for (const w of ways){ const P=w.pts; if (P.length<2) continue; let start=0;
    for (let i=1;i<P.length;i++){ const k=Math.round(P[i][0])+','+Math.round(P[i][1]); const isNode = i===P.length-1 || count.get(k)>1;
      if (!isNode) continue; const seg=P.slice(start,i+1); let len=0; for (let j=1;j<seg.length;j++) len+=Math.hypot(seg[j][0]-seg[j-1][0], seg[j][1]-seg[j-1][1]);
      const a=nodeId(seg[0][0],seg[0][1]), b=nodeId(seg[seg.length-1][0],seg[seg.length-1][1]); if (a===b && len<1){ start=i; continue; }
      const e={a,b,len,pts:seg,name:w.name||(w.road?'road':'trail'),road:w.road,id:graph.edges.length}; graph.edges.push(e); graph.nodes[a].edges.push(e.id); graph.nodes[b].edges.push(e.id);
      for (let j=0;j<seg.length;j++){ const gk=gkey(seg[j][0],seg[j][1]); let arr=graph.grid.get(gk); if(!arr){arr=[];graph.grid.set(gk,arr);} arr.push([e.id,j]); }
      start=i; } }
  // dangling trail ends that touch another trail without sharing a node: snap them on (split the other edge there)
  for (let ni=0; ni<graph.nodes.length; ni++){ const n=graph.nodes[ni]; if (n.edges.length!==1) continue;
    let best=null, bd=6*6; const cx=(n.x/64)|0, cz=(n.z/64)|0;
    for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++){ const arr=graph.grid.get((cx+dx)+','+(cz+dz)); if(!arr) continue;
      for (const [eid,j] of arr){ if (eid===n.edges[0]) continue; const e=graph.edges[eid]; if (j<=0||j>=e.pts.length-1) continue; const p=e.pts[j]; if(!p) continue; const d=(p[0]-n.x)**2+(p[1]-n.z)**2; if (d<bd){bd=d;best={eid,j};} } }
    if (!best) continue;
    const e=graph.edges[best.eid]; const c=edgeCum(e);
    // split e at vertex j into e (a..j) and e2 (j..b), both meeting at node ni
    const tail=e.pts.slice(best.j); const e2={a:ni,b:e.b,len:c[c.length-1]-c[best.j],pts:tail,name:e.name,road:e.road,id:graph.edges.length};
    graph.edges.push(e2); graph.nodes[e.b].edges=graph.nodes[e.b].edges.map(id=>id===e.id?e2.id:id); graph.nodes[ni].edges.push(e2.id);
    e.pts=e.pts.slice(0,best.j+1); e.len=c[best.j]; e.b=ni; e.cum=null; graph.nodes[ni].edges.push(e.id);
  }
  // rebuild the spatial index after splitting
  graph.grid.clear();
  for (const e of graph.edges) for (let j=0;j<e.pts.length;j++){ const gk=gkey(e.pts[j][0],e.pts[j][1]); let arr=graph.grid.get(gk); if(!arr){arr=[];graph.grid.set(gk,arr);} arr.push([e.id,j]); }
  // name nodes by nearest landmark, else by the trails meeting there
  for (const n of graph.nodes){ let best=null,bd=60; for (const L of META.landmarks){ if (['peak','water','camp_site','shelter','trailhead','parking','ranger_station','wilderness_hut','camp_pitch','picnic_site','canoe','building','waterfall','place'].indexOf(L.kind)<0) continue; const d=Math.hypot(L.x-n.x,L.y-n.z); if (d<bd){bd=d;best=L;} }
    if (best) n.name=best.name; else { const names=[...new Set(n.edges.map(id=>graph.edges[id].name))]; n.name = n.edges.length>=3 ? 'jct '+names.slice(0,2).join(' / ') : (n.edges.length===1 ? 'end of '+names[0] : null); } }
}
function nearestTrailPoint(x,z,maxD){ let best=null,bd=maxD*maxD; const cx=(x/64)|0, cz=(z/64)|0;
  for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++){ const arr=graph.grid.get((cx+dx)+','+(cz+dz)); if(!arr) continue; for (const [eid,j] of arr){ const p=graph.edges[eid].pts[j]; if(!p) continue; const d=(p[0]-x)**2+(p[1]-z)**2; if (d<bd){bd=d;best={eid,j};} } }
  return best;
}
function edgeCum(e){ if (e.cum) return e.cum; const c=[0]; for (let j=1;j<e.pts.length;j++) c.push(c[j-1]+Math.hypot(e.pts[j][0]-e.pts[j-1][0], e.pts[j][1]-e.pts[j-1][1])); e.cum=c; return c; }
function fmtDist(b){ const m=b*BLOCK_M; return (m/1609.344).toFixed(m<1609?2:1)+' mi ('+(m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km')+')'; }
// what does the crosshair point at on the ground? (fly-friendly: samples the smooth height field along the view ray)
function groundHit(maxD){ const ox=camera.position.x,oy=camera.position.y,oz=camera.position.z; const dx=-Math.sin(player.yaw)*Math.cos(player.pitch),dy=Math.sin(player.pitch),dz=-Math.cos(player.yaw)*Math.cos(player.pitch);
  if (dy>=-0.02) return null; let step=2, prev=2;
  for (let t=2;t<maxD;t+=step){ const x=ox+dx*t, z=oz+dz*t, y=oy+dy*t;
    if (lodH(x,z)>=y){ let lo=prev, hi=t; for (let k=0;k<12;k++){ const m=(lo+hi)/2; if (lodH(ox+dx*m,oz+dz*m)>=oy+dy*m) hi=m; else lo=m; } return {x:ox+dx*hi, z:oz+dz*hi, t:hi}; }
    prev=t; step=Math.max(2,t*0.03); } return null; }
// Dijkstra between two points on the graph (each given as edge+vertex index)
function routeBetween(A,B){
  const ea=graph.edges[A.eid], eb=graph.edges[B.eid]; if (A.eid===B.eid){ const c=edgeCum(ea); const i0=Math.min(A.j,B.j), i1=Math.max(A.j,B.j); const seg=ea.pts.slice(i0,i1+1); if (A.j>B.j) seg.reverse(); return {pts:seg, len:c[i1]-c[i0], names:[ea.name]}; }
  const ca=edgeCum(ea), cb=edgeCum(eb); const dist=new Map(), prev=new Map(); const pq=[];
  const push=(n,d,via)=>{ if (dist.has(n)&&dist.get(n)<=d) return; dist.set(n,d); prev.set(n,via); pq.push([d,n]); };
  push(ea.a, ca[A.j], {start:true,eid:A.eid,fromEnd:'a'}); push(ea.b, ca[ca.length-1]-ca[A.j], {start:true,eid:A.eid,fromEnd:'b'});
  const done=new Set(); let bestEnd=null, bestD=Infinity;
  while (pq.length){ pq.sort((p,q)=>p[0]-q[0]); const [d,n]=pq.shift(); if (done.has(n)) continue; done.add(n); if (d>bestD) break;
    if (n===eb.a){ const tot=d+cb[B.j]; if (tot<bestD){bestD=tot;bestEnd={n,end:'a'};} } if (n===eb.b){ const tot=d+cb[cb.length-1]-cb[B.j]; if (tot<bestD){bestD=tot;bestEnd={n,end:'b'};} }
    for (const eid of graph.nodes[n].edges){ const e=graph.edges[eid]; const m=e.a===n?e.b:e.a; push(m, d+e.len, {eid, from:n}); } }
  if (!bestEnd) return null;
  // reconstruct: walk prev chain back to the start edge
  const chain=[]; let n=bestEnd.n; while (true){ const v=prev.get(n); if (!v) break; chain.unshift(v); if (v.start) break; n=v.from; }
  const pts=[]; const names=[]; const first=chain[0];
  const startSeg = first.fromEnd==='a' ? ea.pts.slice(0,A.j+1).reverse() : ea.pts.slice(A.j); pts.push(...startSeg); names.push(ea.name);
  let cur = first.fromEnd==='a' ? ea.a : ea.b;
  for (let i=1;i<chain.length;i++){ const e=graph.edges[chain[i].eid]; const seg = e.a===cur ? e.pts : [...e.pts].reverse(); pts.push(...seg.slice(1)); cur = e.a===cur ? e.b : e.a; if (names[names.length-1]!==e.name) names.push(e.name); }
  const endSeg = bestEnd.end==='a' ? eb.pts.slice(0,B.j+1) : eb.pts.slice(B.j).reverse(); pts.push(...endSeg.slice(1)); if (names[names.length-1]!==eb.name) names.push(eb.name);
  return {pts, len:bestD, names};
}
// gain/loss along a polyline, sampled every ~15 m along the path with 3 m hysteresis (like a GPS watch) so lidar noise doesn't inflate the totals
function elevProfile(pts){
  const hs=[]; let acc=0;
  for (let i=0;i<pts.length;i++){ if (i>0) acc+=Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); if (i===0||i===pts.length-1||acc>=5){ acc=0; hs.push(lodH(pts[i][0],pts[i][1])*BLOCK_M); } }
  let gain=0, loss=0; if (!hs.length) return {gain,loss};
  let ref=hs[0], dir=0, ext=hs[0]; const HYS=3;
  for (let k=1;k<hs.length;k++){ const h=hs[k];
    if (dir>=0){ if (h>ext) ext=h; else if (ext-h>HYS){ gain+=ext-ref; ref=ext; dir=-1; ext=h; } }
    if (dir<0){ if (h<ext) ext=h; else if (h-ext>HYS){ loss+=ref-ext; ref=ext; dir=1; ext=h; } } }
  if (dir>=0) gain+=Math.max(0,ext-ref); else loss+=Math.max(0,ref-ext);
  return {gain,loss}; }

// ---------- route state & drawing -------------------------------------------------------------------
const route={waypoints:[], legs:[], mesh:null, markers:[], total:0, hidden:false};
let routeMode=false; const rpanel=document.getElementById('route');
function clearRouteMesh(){ if (route.mesh){ scene.remove(route.mesh); route.mesh.geometry.dispose(); route.mesh=null; } for (const m of (route.extra||[])){ scene.remove(m); m.geometry.dispose(); } route.extra=[]; for (const m of route.markers){ scene.remove(m); m.material.map.dispose(); m.material.dispose(); } route.markers=[]; }
function ribbon(pts, width, lift, color){
  const pos=[], idx=[]; let vi=0;
  for (let i=0;i<pts.length;i++){ const p=pts[i], q=pts[Math.min(pts.length-1,i+1)], o=pts[Math.max(0,i-1)]; let dx=q[0]-o[0], dz=q[1]-o[1]; const l=Math.hypot(dx,dz)||1; dx/=l; dz/=l; const nx=-dz*width/2, nz=dx*width/2;
    const y=Math.max(hAt(Math.round(p[0]),Math.round(p[1])), lodH(p[0],p[1]))+lift; pos.push(p[0]+nx,y,p[1]+nz, p[0]-nx,y,p[1]-nz);
    if (i>0){ idx.push(vi-2,vi-1,vi, vi-1,vi+1,vi); } vi+=2; }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setIndex(idx);
  return new THREE.Mesh(g,new THREE.MeshBasicMaterial({color, side:THREE.DoubleSide, depthTest:false, transparent:true, opacity:0.9}));
}
function textSprite(text, color, scale){ const c=document.createElement('canvas'); c.width=256; c.height=64; const g=c.getContext('2d'); g.font='bold 34px ui-monospace, Menlo, monospace'; g.textAlign='center'; g.textBaseline='middle'; g.lineWidth=6; g.strokeStyle='rgba(0,0,0,.85)'; g.strokeText(text,128,32); g.fillStyle=color; g.fillText(text,128,32);
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:true,depthWrite:false,transparent:true})); s.center.set(0.5,0); s.userData.base=scale; return s; }
function rebuildRoute(){
  clearRouteMesh(); route.legs=[]; route.total=0;
  for (let i=1;i<route.waypoints.length;i++){ let r=routeBetween(route.waypoints[i-1], route.waypoints[i]);
    if (!r){ const p=graph.edges[route.waypoints[i-1].eid].pts[route.waypoints[i-1].j], q=graph.edges[route.waypoints[i].eid].pts[route.waypoints[i].j]; const n=Math.max(2,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/20)); const pts=[]; for (let k=0;k<=n;k++) pts.push([p[0]+(q[0]-p[0])*k/n, p[1]+(q[1]-p[1])*k/n]); r={pts, len:Math.hypot(q[0]-p[0],q[1]-p[1]), names:['off-trail (no connecting trail found)'], offtrail:true}; }
    const ep=elevProfile(r.pts); route.legs.push({...r, ...ep}); route.total+=r.len; }
  const all=[]; for (const l of route.legs) if (l) all.push(...(all.length?l.pts.slice(1):l.pts));
  if (all.length>1 && !route.hidden){ for (const l of route.legs){ if (!l) continue; const m=ribbon(l.pts, l.offtrail?1.2:2.2, 1.6, l.offtrail?0x9a9aa0:0xff3fa0); if (l.offtrail){ m.material.opacity=0.6; } scene.add(m); route.extra=(route.extra||[]); route.extra.push(m); }
    // mile markers
    let acc=0, next=MI; for (let i=1;i<all.length;i++){ const d=Math.hypot(all[i][0]-all[i-1][0], all[i][1]-all[i-1][1]); if (acc+d>=next){ const u=(next-acc)/d; const x=all[i-1][0]+(all[i][0]-all[i-1][0])*u, z=all[i-1][1]+(all[i][1]-all[i-1][1])*u; const s=textSprite((next/MI).toFixed(0)+' mi','#ff9ad0',1); s.position.set(x, Math.max(hAt(Math.round(x),Math.round(z)),lodH(x,z))+4, z); scene.add(s); route.markers.push(s); next+=MI; } acc+=d; } }
  if (!route.hidden) for (const [i,w] of route.waypoints.entries()){ const p=graph.edges[w.eid].pts[w.j]; const s=textSprite(i===0?'START':(i===route.waypoints.length-1?'END':String(i)), '#ffffff', 1.2); s.position.set(p[0], Math.max(hAt(Math.round(p[0]),Math.round(p[1])),lodH(p[0],p[1]))+6, p[1]); scene.add(s); route.markers.push(s); }
  try{ localStorage.removeItem('bsp_route'); localStorage.setItem('bsp_route2', JSON.stringify(route.waypoints.map(w=>{ const p=graph.edges[w.eid].pts[w.j]; return [Math.round(p[0]*10)/10, Math.round(p[1]*10)/10]; }))); }catch(e){}
  renderRoutePanel();
}
function renderRoutePanel(){
  if (!routeMode){ rpanel.style.display='none'; return; } rpanel.style.display='block';
  let html='<h3>Route planner <span style="opacity:.6;font-weight:400;font-size:12px">(P to close)</span></h3>';
  html+='<p class="how">Aim the crosshair at a trail and <b>click</b> to add a waypoint (works from the air). <b>U</b> removes the last one, <b>Backspace</b> clears.</p>';
  html+=`<p class="btns"><button data-act="undo">Undo last</button> <button data-act="clear">Clear route</button> <button data-act="hide">${route.hidden?'Show route':'Hide route'}</button></p>`;
  if (!route.waypoints.length) html+='<p>No waypoints yet.</p>'; else if (route.waypoints.length===1) html+=`<p>Start set on <b>${graph.edges[route.waypoints[0].eid].name}</b> — click another trail point.</p>`;
  else { let g=0,lo=0; for (const l of route.legs) if(l){g+=l.gain;lo+=l.loss;}
    html+=`<p class="tot top">Total <b>${fmtDist(route.total)}</b> · ${route.waypoints.length} points<br><span class="sub">↑ ${Math.round(g*3.281)} ft gain · ↓ ${Math.round(lo*3.281)} ft loss · ~${(route.total*BLOCK_M/1609.344/2.0+g*3.281/1000).toFixed(1)} h at book pace · scroll wheel to see all legs</span></p>`;
    html+='<ol>'; for (let i=0;i<route.legs.length;i++){ const l=route.legs[i]; html+= l ? `<li${l.offtrail?' style="opacity:.7"':''}><b>${fmtDist(l.len)}</b> ${l.offtrail?'<em>straight line — no trail connects these points</em>':'via '+(l.names.filter(n=>n!=='trail'&&n!=='road').filter((n,i,a)=>a.indexOf(n)===i).join(' → ')||'unnamed trail')} <span class="sub">↑${Math.round(l.gain*3.281)} ↓${Math.round(l.loss*3.281)} ft</span></li>` : '<li>no trail connection</li>'; } html+='</ol>'; }
  rpanel.innerHTML=html;
  rpanel.querySelectorAll('button').forEach(b=>b.onclick=(ev)=>{ ev.stopPropagation(); const a=b.dataset.act; if (a==='undo') route.waypoints.pop(); if (a==='clear') route.waypoints.length=0; if (a==='hide') route.hidden=!route.hidden; rebuildRoute(); });
}
function routeClick(button){
  const hit=groundHit(6000); if (!hit){ flash('aim at the ground'); return; }
  if (button===2){ route.waypoints.pop(); rebuildRoute(); return; }
  const np=nearestTrailPoint(hit.x,hit.z, 80); if (!np){ flash('no trail there — aim closer to a trail'); return; }
  route.waypoints.push(np); rebuildRoute(); const e=graph.edges[np.eid]; flash('waypoint '+route.waypoints.length+' on '+e.name);
}
function toggleRoute(){ routeMode=!routeMode; renderRoutePanel(); flash(routeMode?'route planner on — click trails to add waypoints · Esc frees the mouse for the panel buttons':'route planner off — the route stays; Backspace clears it, P reopens'); }
// hover: which trail is under the crosshair, and how far along it to the next named points
let hoverText='';
function updateHover(){
  hoverText=''; const hit=groundHit(5000); if (!hit) return; const np=nearestTrailPoint(hit.x,hit.z, 45); if (!np) return;
  const e=graph.edges[np.eid], c=edgeCum(e); const na=graph.nodes[e.a], nb=graph.nodes[e.b];
  const dA=c[np.j], dB=c[c.length-1]-c[np.j];
  hoverText=`${e.name}   ◂ ${fmtDist(dA)} to ${na.name||'junction'}   ·   ${fmtDist(dB)} to ${nb.name||'junction'} ▸`;
}


// ---------- real photos (Wikimedia Commons, geotagged) ----------------------------------------------
// data/photos.js: [{x,z (block coords), lat, lon, hdg (deg, view direction or null), pano, cap, date, thumb, full, by, lic, page}]
const PHOTOS_ALL=(window.PHOTOS||[]).slice();
const ppanel=document.getElementById('photos'), pview=document.getElementById('pview');
let nearPhotos=[], shownIds='', pviewOpen=false, pviewIdx=0;
const COMPASS16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
function bearingTo(ph){ return (Math.atan2(ph.x-player.x, -(ph.z-player.z))*180/Math.PI+360)%360; }   // 0=N (−z), 90=E (+x)
function playerHeading(){ return ((-player.yaw)*180/Math.PI+360)%360; }
function fmtM(b){ const m=b*BLOCK_M; return m<1000?Math.round(m)+' m':(m/1000).toFixed(1)+' km'; }
function updatePhotos(){
  if (!catOn.photos || !PHOTOS_ALL.length){ if (ppanel.style.display!=='none'){ ppanel.style.display='none'; shownIds=''; } nearPhotos=[]; return; }
  const agl=Math.max(0, player.y-lodH(player.x,player.z)); const R=100+agl*2;      // ~300 m on the ground, farther when flying
  const hd=playerHeading(); const c=[];
  for (const ph of PHOTOS_ALL){ const d=Math.hypot(ph.x-player.x, ph.z-player.z); if (d>R) continue;
    let score=d; if (ph.hdg!=null){ let a=Math.abs(ph.hdg-hd); if(a>180)a=360-a; score+=a*0.35; } else score+=25;   // prefer photos looking the way you look
    c.push([score,d,ph]); }
  c.sort((a,b)=>a[0]-b[0]); nearPhotos=c.slice(0,4).map(e=>e[2]);
  const ids=nearPhotos.map(p=>p.id).join(',');
  if (ids!==shownIds){ shownIds=ids;
    if (!nearPhotos.length){ ppanel.style.display='none'; return; }
    let html='<h3>📷 Real photos here <span>V: fullscreen · N: hide</span></h3>';
    nearPhotos.forEach((ph,i)=>{ html+=`<div class="ph" data-i="${i}"><img src="${ph.thumb}" loading="lazy" alt=""><div class="cap">${ph.cap}</div><div class="meta"><span class="arrow" data-id="${ph.id}">➤</span> <span class="d"></span>${ph.hdg!=null?' · looking '+COMPASS16[Math.round(ph.hdg/22.5)%16]:''}${ph.pano?' · panorama':''}</div></div>`; });
    ppanel.innerHTML=html; ppanel.style.display='block';
    ppanel.querySelectorAll('.ph').forEach(el=>el.onclick=()=>openPhoto(+el.dataset.i)); }
  // live distance + direction arrows
  ppanel.querySelectorAll('.ph').forEach((el,i)=>{ const ph=nearPhotos[i]; if(!ph) return; const d=Math.hypot(ph.x-player.x, ph.z-player.z); el.querySelector('.d').textContent=d<3?'you are here':fmtM(d)+' away';
    const rel=(bearingTo(ph)-hd+360)%360; el.querySelector('.arrow').style.transform=`rotate(${rel-90}deg)`; el.querySelector('.arrow').style.opacity=d<3?0:1; });
}
function openPhoto(i){ if (!nearPhotos.length) return; pviewIdx=Math.max(0,Math.min(nearPhotos.length-1,i||0)); pviewOpen=true; renderPhotoView(); pview.style.display='flex'; document.exitPointerLock(); }
function closePhoto(){ pviewOpen=false; pview.style.display='none'; canvas.requestPointerLock(); }
function renderPhotoView(){ const ph=nearPhotos[pviewIdx]; if(!ph) return;
  pview.innerHTML=`<img src="${ph.full}" alt=""><div class="pcap"><b>${ph.cap}</b><br><span>${ph.date?ph.date+' · ':''}${ph.hdg!=null?'looking '+COMPASS16[Math.round(ph.hdg/22.5)%16]+' · ':''}${ph.lat.toFixed(5)}, ${ph.lon.toFixed(5)} · photo by ${ph.by} · ${ph.lic} · <a href="${ph.page}" target="_blank" rel="noopener">Wikimedia Commons</a></span><br><span class="hint">← → next photo nearby (${pviewIdx+1}/${nearPhotos.length}) · Esc or V to close</span></div><div class="pclose">✕</div>`;
  pview.querySelector('.pclose').onclick=closePhoto; pview.querySelector('img').onclick=closePhoto; }

// ---------- input ------------------------------------------------------------------------------
const intro=document.getElementById('intro'); let running=false; let tpIdx=-1;
addEventListener('keydown',e=>{
  if (pviewOpen){ if (e.code==='Escape'||e.code==='KeyV'){ closePhoto(); } else if (e.code==='ArrowRight'){ pviewIdx=(pviewIdx+1)%nearPhotos.length; renderPhotoView(); } else if (e.code==='ArrowLeft'){ pviewIdx=(pviewIdx+nearPhotos.length-1)%nearPhotos.length; renderPhotoView(); } e.preventDefault(); return; }
  if (e.code==='KeyV'){ if (nearPhotos.length) openPhoto(0); else flash(catOn.photos?'no real photos within range — look for 📷 markers':'photos are hidden — turn them on with N'); return; }
  if (e.code==='KeyN'){ toggleLabelPanel(); return; }
  if (e.code==='KeyP'){ toggleRoute(); return; }
  if (e.code==='KeyE' && !routeMode && document.pointerLockElement===canvas){ placeBlock(); return; }
  if (e.code==='KeyU' && routeMode){ route.waypoints.pop(); rebuildRoute(); flash('removed last waypoint'); return; }
  if (e.code==='Backspace' && !routeMode && route.waypoints.length){ route.waypoints.length=0; rebuildRoute(); flash('route cleared'); return; }
  if (e.code==='Backspace' && routeMode){ route.waypoints.length=0; rebuildRoute(); return; }
  if ((listOpen||lpanelOpen) && e.code!=='KeyL' && e.code!=='Escape') return;
  keys[e.code]=true;
  if (e.code==='Space'){ const n=performance.now();
    if (!player.fly && !e.repeat && n-lastSpace<260){ player.fly=true; player.vy=0; flash('flying — hold Space/Shift to climb/descend, double-tap Shift to land, F toggles'); }
    if (!e.repeat) lastSpace=n; e.preventDefault(); }
  if (e.code==='ShiftLeft'||e.code==='ShiftRight'){ const n=performance.now();
    if (player.fly && !e.repeat && n-lastShift<260){ player.fly=false; player.vy=0; flash('landing'); }
    if (!e.repeat) lastShift=n; }
  if (e.code==='KeyO' && nearEgg()){ window.open(EGG_URL,'_blank','noopener'); return; }
  if (e.code==='KeyF'){ player.fly=!player.fly; player.vy=0; flash(player.fly?'flying':'walking'); }
  if (e.code.startsWith('Digit')){ const d=+e.code.slice(5); if(d>=1&&d<=HOTBAR.length){ player.hot=d-1; buildHotbar(); } }
  if (e.code==='BracketLeft') dayT=(dayT-0.02+1)%1; if (e.code==='BracketRight') dayT=(dayT+0.02)%1;
  if (e.code==='KeyM') mapZoom++; if (e.code==='KeyR') spawn(); if (e.code==='KeyL') toggleList();
  if (e.code==='KeyY'){ season=SEASONS[(SEASONS.indexOf(season)+1)%SEASONS.length]; try{localStorage.setItem('bsp_season',season);}catch(_){} for (const k of chunks.keys()) dirty.add(k); updateChunks(player.x,player.z); flash('season: '+season); }
  if (e.code==='Minus'||e.code==='Equal'){ VIEW_R=Math.max(5,Math.min(20,VIEW_R+(e.code==='Equal'?1:-1))); try{localStorage.setItem('bsp_viewr',VIEW_R);}catch(_){} updateChunks(player.x,player.z); flash('block distance: '+VIEW_R+' chunks ('+(VIEW_R*CH*BLOCK_M/1000).toFixed(1)+' km)'); }
  if (e.code==='KeyT'){ const peaks=META.landmarks.filter(l=>l.kind==='peak'); tpIdx=(tpIdx+1)%peaks.length; goTo(peaks[tpIdx]); }
});
addEventListener('keyup',e=>{ keys[e.code]=false; });
document.addEventListener('mousemove',e=>{ if(document.pointerLockElement!==canvas) return; player.yaw-=e.movementX*0.0022; player.pitch-=e.movementY*0.0022; player.pitch=Math.max(-1.55,Math.min(1.55,player.pitch)); });
canvas.addEventListener('mousedown',e=>{
  if (document.pointerLockElement!==canvas){ if(!listOpen&&!pviewOpen) canvas.requestPointerLock(); return; }
  if (routeMode){ routeClick(e.button); return; }
  if (e.button===0){ const hit=raycast(8); if(hit) setBlock(hit.x,hit.y,hit.z,T.AIR); }
  else if (e.button===2) placeBlock();
});
function placeBlock(){ const hit=raycast(8); if(!hit) return; const px=hit.x+hit.face[0],py=hit.y+hit.face[1],pz=hit.z+hit.face[2];
  const inP=px>=Math.floor(player.x-HW)&&px<=Math.floor(player.x+HW)&&pz>=Math.floor(player.z-HW)&&pz<=Math.floor(player.z+HW)&&py>=Math.floor(player.y)&&py<=Math.floor(player.y+PH);
  if(!inP&&typeAt(px,py,pz)===T.AIR) setBlock(px,py,pz,HOTBAR[player.hot].t); }
canvas.addEventListener('contextmenu',e=>e.preventDefault());
addEventListener('wheel',e=>{ if (routeMode && rpanel.style.display!=='none'){ rpanel.scrollTop += e.deltaY; } }, {passive:true});
document.addEventListener('pointerlockchange',()=>{ if(document.pointerLockElement!==canvas){ if(!listOpen&&!lpanelOpen&&!pviewOpen) intro.style.display='flex'; } else intro.style.display='none'; });
intro.addEventListener('click',()=>{ if(running) canvas.requestPointerLock(); });

function spawn(){ const bax=META.landmarks.find(l=>/^Baxter Peak$/i.test(l.name)); const pam=META.landmarks.find(l=>/^Pamola$/i.test(l.name));
  const x=Math.round(bax.x), z=Math.round(bax.y)+6; player.x=x+0.5; player.z=z+0.5; player.y=lodH(player.x,player.z)+3; player.fly=false;
  player.yaw=0; player.pitch=0.02; updateChunks(player.x,player.z); pendingSnap={x,z,tries:0,summit:true}; }

// ---------- main loop ------------------------------------------------------------------------------
let last=performance.now();
function frame(){
  requestAnimationFrame(frame);
  const now=performance.now(); let dt=(now-last)/1000; last=now; if(dt>0.05)dt=0.05;
  fcount++; ftime+=dt; if(ftime>0.5){fps=Math.round(fcount/ftime);fcount=0;ftime=0;}
  for (let i=signsPending.length-1;i>=0;i--){ const L=signsPending[i]; let x=Math.round(L.x), z=Math.round(L.y); const tl=tileOf(x,z); if(tl&&tl.state==='ready'){ [x,z]=highestNear(x,z,6); /* the sign stands on the very highest block */ makeSign(L,x,z); markDirty(x,0,z); signsPending.splice(i,1); } }
  if (pendingSnap){ const {x,z}=pendingSnap; const tl=tileOf(x,z); if (!inCore(x,z)) pendingSnap=null; else if (tl&&tl.state==='ready'){ if (pendingSnap.hover){ player.y=hAt(x,z)+8; player.fly=true; } else if (pendingSnap.summit){ const [sx,sz]=highestNear(x,z-6,6); placeOnTop(sx,sz+6); player.yaw=0; } else placeOnTop(x,z); pendingSnap=null; } else if (++pendingSnap.tries>600) pendingSnap=null; else { player.vy=0; } }
  step(dt); dayT=(dayT+dt/1200)%1;
  const pcx=Math.floor(player.x/CH), pcz=Math.floor(player.z/CH);
  if (pcx!==frame.lcx||pcz!==frame.lcz||dirty.size){ updateChunks(player.x,player.z); frame.lcx=pcx; frame.lcz=pcz; }
  pumpQueue(queue.length>60?14:7);
  camera.position.set(player.x,player.y+EYE,player.z); camera.rotation.set(0,0,0); camera.rotateY(player.yaw); camera.rotateX(player.pitch);
  const hit=document.pointerLockElement===canvas?raycast(8):null; if(hit){hl.visible=true;hl.position.set(hit.x+0.5,hit.y+0.5,hit.z+0.5);} else hl.visible=false;
  updateLabels(); if ((labelTick&3)===0) updateHover(); if ((labelTick&7)===0) updatePhotos();
  for (const m of route.markers){ const k=Math.min(Math.max(1.2, camera.position.distanceTo(m.position)*0.05), 300)*m.userData.base; m.scale.set(k*4,k,1); }
  if (flashT && performance.now()-flashT>2200){ flashEl.style.opacity=0; flashT=0; }
  { const d=heading(); compassEl.innerHTML=`<b>${DIRS[Math.round(d/22.5)%16]}</b> ${Math.round(d).toString().padStart(3,'0')}°`+(player.fly?`  ·  fly ${Math.round(Math.hypot(player.vx,player.vz)*BLOCK_M*3.6)} km/h`:''); }
  updateSky(); updateHUD(); drawMap(); renderer.render(scene,camera);
}

(async()=>{
  const load=document.getElementById('load');
  load.textContent='decoding terrain…';
  LOD.park = await decodeLod(__LOD.park); LOD.core = __LOD.core ? await decodeLod(__LOD.core) : null;
  MINI=__LOD.mini; miniImg=await loadImage('data:image/jpeg;base64,'+__LOD.mini.jpg);
  load.textContent='building far terrain…'; await new Promise(r=>setTimeout(r,10));
  if (LOD.core){ buildFar(LOD.park, window.__TEX&&__TEX.park, true, 2.5); buildFar(LOD.core, window.__TEX&&__TEX.core, false, 1.6); } else buildFar(LOD.park, window.__TEX&&__TEX.park, false, 1.6);
  buildLines();
  if (window.EXTRA_NAMES) for (const n of EXTRA_NAMES){ if (!n.name || n.lat==null || n.lon==null) continue; const [E,N]=latLonToUtm(n.lat,n.lon); const x=(E-META.utm.e0)/BLOCK_M, z=(META.utm.n1-N)/BLOCK_M;
    if (inCore(Math.round(x),Math.round(z))) META.landmarks.push({name:n.name, kind:n.kind||'terrain', x:Math.round(x*10)/10, y:Math.round(z*10)/10, note:n.note||''}); }
  buildLabelDefs(); buildLabelPanel(); try{ buildGraph(); }catch(err){ console.error('trail graph failed', err); }
  try{ localStorage.removeItem('bsp_route'); const saved=JSON.parse(localStorage.getItem('bsp_route2')||'[]'); route.waypoints=saved.map(p=>nearestTrailPoint(p[0],p[1],6)).filter(Boolean); if (route.waypoints.length) rebuildRoute(); }catch(e){}
  buildHotbar(); buildList(); spawn();
  load.textContent='streaming the summit…';
  const t0=performance.now(); while (performance.now()-t0<12000){ updateChunks(player.x,player.z); pumpQueue(200); await new Promise(r=>setTimeout(r,30)); if (chunks.size>60) break; }
  load.textContent='ready'; running=true; last=performance.now(); frame();
  window.__game={player,chunks,tiles,spawn,placeOnTop,goTo,raycast,typeAt,hAt,tAt,lodH,META,setDay:t=>{dayT=t;},updateChunks,pumpQueue,graph,routeClick,route,nearestTrailPoint,groundHit,__rebuild:rebuildRoute,elevProfile,get nearPhotos(){return nearPhotos;},get eggSign(){return eggSign;},T,setSeason:s=>{season=s; for (const k of chunks.keys()) dirty.add(k); updateChunks(player.x,player.z);},get season(){return season;}};
})();
})();
