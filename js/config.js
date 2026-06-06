// config.js — all the tunable numbers live here, so balancing is one file to edit.
window.LS = window.LS || {};

LS.config = {
  cols: 44,            // map size (can exceed the viewport — the camera scrolls)
  rows: 32,
  tile: 44,            // pixel size of one grid square
  view: { cols: 22, rows: 15 }, // visible window onto the map (desktop-first: show a big chunk of the battlefield)
  aiTeams: ['red'],    // teams played by the computer; empty = hot-seat two-player

  ap: {
    max: 20,           // action points each unit gets per turn
    moveOrtho: 2,      // cost to step N/E/S/W
    moveDiag: 3,       // cost to step diagonally
    turn: 0,           // turning is free in this build (auto-facing); a real cost lands with opportunity fire
    door: 4,           // open/close a door, or smash a window from an adjacent tile
  },

  combat: {
    sightRange: 12,    // tiles a unit can see / shoot
    arcHalfDeg: 100,   // forward vision half-angle — tracked now, enforced once opportunity fire exists
    baseAccuracy: 0.95,
    falloffPerTile: 0.05,
    minHit: 0.10,
    maxHit: 0.95,
    coverPenalty: 0.25, // hit-chance cut when a wall shields the target on the shooter's side
  },

  grenade: {
    count: 2,         // grenades each soldier carries
    throwCost: 6,     // AP to throw (~the 25% the original used)
    range: 6,         // max throw distance (tiles); lobbed, so no line of sight needed
    radius: 2,        // blast reaches this far (Manhattan diamond); walls stop it
    dmgCenter: 8,     // damage at the epicentre
    dmgFalloff: 2.5,  // damage lost per tile from the centre
    wallBreakRadius: 1, // a destructible DOOR within this many tiles is blown apart
    craterChance: 0.35, // chance the tile a grenade lands on becomes an impassable crater
    // breakable walls have hidden, randomised hit points and take blast damage by distance,
    // so a wall might survive a hit and need another. (Doors stay flimsy; people-damage stays fixed.)
    wallHpMin: 3,
    wallHpMax: 9,
    wallDmgCenter: 12,
    wallDmgFalloff: 4,
  },

  anim: {
    enabled: true,
    msPerTile: 150,    // movement glide speed (slower = easier to read the move)
  },

  colors: {
    groundA: '#39463c',
    groundB: '#35423a',
    floorA:  '#4a443d',
    floorB:  '#464039',
    // --- Assassins art pass: terrain inspired by the 1988 original ---
    grassBase:  '#0e150c',  // dark soil
    grassFleckA:'#2c5e2e',  // scattered grass specks (two tones)
    grassFleckB:'#3f8442',
    floorBase:  '#0f1318',  // interior tile
    floorGrid:  'rgba(78,126,196,0.42)', // blue grout grid
    wallFace:   '#737a83',  // stone wall — one light grey for every wall
    wallTopLt:  '#9ca3ad',  // lit top/edge (light from screen-top)
    wallEdge:   '#2b2f35',
    wallMortar: 'rgba(28,30,36,0.5)',
    doorGold:   '#c8a23c',  // gold door leaf / frame
    doorGoldDk: '#7d631e',
    door:    '#5b5048',
    wall:    '#21242a',
    wallTop: '#2e333b',
    wallWeak:'#3a3d45',   // breakable wall (reads lighter than the reinforced one)
    crack:   'rgba(16,17,21,0.6)', // hairline crack on a breakable wall
    rubble:  '#6b7079',   // broken stone where a wall/door was blown open (passable)
    rubbleLt:'#969ca5',   // lit top of a rubble chunk
    crater:  '#0a0b0d',   // blast crater pit (impassable hole)
    craterRim:'#241d12',  // charred raised rim
    craterEjecta:'#4a3d28', // scorched debris flung around it
    doorLeaf:'#856a4b',   // a closed wooden door
    doorFrame:'#4a3f33',  // door posts / frame
    doorSteel:'#5e6772',  // a reinforced (blast-proof) door
    doorSteelFrame:'#3a4048',
    glass:   'rgba(140,195,225,0.30)',  // intact window pane
    glassEdge:'rgba(175,215,240,0.75)', // window mullions / frame
    // decor objects, palette drawn from the original Assassins map
    crateTop:  '#8a6e44',  // wooden crate lid
    crateBody: '#624d31',  // crate sides
    crateEdge: 'rgba(0,0,0,0.4)',
    crateBrace:'#9c7c4c',  // X-brace banding
    tableTop:  '#3fc6cf',  // cyan dining table
    tableTopHi:'#86e6ec',
    tableLeg:  '#1f6e74',
    chair:     '#8b929c',  // grey chairs around a table
    lockerBody:'#7a818a',  // grey steel cabinet (matches walls)
    lockerEdge:'#34383e',
    lockerHandle:'#c2c8d0',
    consoleBody:'#4a525c',          // grey console
    consoleEdge:'#272c32',
    consoleScreen:'rgba(96,206,176,0.6)', // teal screen
    bedFrame:'#6a5526',  // yellow bed
    bedSheet:'#d8b836',
    bedPillow:'#f1e7b2',
    treeCanopy:'#2f6b34', // tree (tall cover, outdoors)
    treeCanopy2:'#3e8746',
    treeCanopyHi:'#58a85f',
    treeTrunk:'#c7a23c',  // bright yellow/ochre forked trunk (the original's signature)
    treeTrunkDk:'#8a6d22',
    shrubBody:'#347d3d',  // shrub (low cover, outdoors)
    shrubHi:'#4fa057',
    reedBlade:'#5fbcc6',  // pale-cyan reed tufts (passable field flora)
    reedHi:'#a6e6ec',
    flowerStem:'#3a8a45', // flowerbeds (passable field flora)
    plantPot:'#9c6238',   // potted plant (indoor)
    plantLeaf:'#3a9048',
    plantLeafHi:'#56b061',
    grid:    'rgba(255,255,255,0.045)',
    blue:    '#4aa3ff',
    blueDark:'#1f5fa6',
    red:     '#ff5d5d',
    redDark: '#a62f2f',
    reachBlue:'rgba(74,163,255,0.20)',   // move here AND keep enough AP to react (blue team)
    reachRed: 'rgba(255,93,93,0.20)',    // ditto, red team
    reachSpent:'rgba(150,162,180,0.13)', // reachable but you'd be too spent to reaction-fire
    threatEnemy:'rgba(255,93,93,0.16)',  // tiles an ENEMY soldier can watch (danger)
    threatAlly: 'rgba(90,205,160,0.15)', // tiles one of YOUR soldiers can watch (field of view)
    select:  '#ffd166',
    target:  '#ff5d5d',
    path:    '#ffd166',
    fog:     'rgba(8,10,14,0.52)',  // veil over tiles your squad can't currently see
    throwRange:'rgba(255,170,60,0.16)', // tiles you can lob a grenade to
    blast:   'rgba(255,120,40,0.34)',   // grenade blast preview / live-grenade danger zone
    grenadeBody:'#39402a',              // thrown grenade marker
    fuse:    '#ff5d5d',                 // its lit fuse
  },
};

// 8 facings, clockwise from North. Index stored on each unit.
LS.DIRS = [
  { dx: 0,  dy: -1 }, // 0 N
  { dx: 1,  dy: -1 }, // 1 NE
  { dx: 1,  dy: 0  }, // 2 E
  { dx: 1,  dy: 1  }, // 3 SE
  { dx: 0,  dy: 1  }, // 4 S
  { dx: -1, dy: 1  }, // 5 SW
  { dx: -1, dy: 0  }, // 6 W
  { dx: -1, dy: -1 }, // 7 NW
];

// small shared helpers
LS.util = {
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  randInt: (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)),
  dirIndex(dx, dy) {
    const sx = Math.sign(dx), sy = Math.sign(dy);
    return LS.DIRS.findIndex(d => d.dx === sx && d.dy === sy);
  },
  // nearest of the 8 facings to an arbitrary vector (for the click-to-turn ring)
  nearestDir(dx, dy) {
    const dl = Math.hypot(dx, dy) || 1;
    let best = 0, bestDot = -Infinity;
    for (let i = 0; i < 8; i++) {
      const d = LS.DIRS[i], l = Math.hypot(d.dx, d.dy);
      const dot = (d.dx * dx + d.dy * dy) / (l * dl);
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    return best;
  },
};
