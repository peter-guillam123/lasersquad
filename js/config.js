// config.js — all the tunable numbers live here, so balancing is one file to edit.
window.LS = window.LS || {};

LS.config = {
  cols: 26,            // map size (can exceed the viewport — the camera scrolls)
  rows: 18,
  tile: 44,            // pixel size of one grid square
  view: { cols: 16, rows: 12 }, // visible window onto the map (in tiles)
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
    door:    '#5b5048',
    wall:    '#21242a',
    wallTop: '#2e333b',
    wallWeak:'#3a3d45',   // breakable wall (reads lighter than the reinforced one)
    crack:   'rgba(16,17,21,0.6)', // hairline crack on a breakable wall
    rubble:  '#6b5d49',   // debris where a wall/door was blown open (passable)
    crater:  '#070809',   // blast crater (impassable hole)
    craterEdge:'rgba(0,0,0,0.5)',
    doorLeaf:'#856a4b',   // a closed wooden door
    doorFrame:'#4a3f33',  // door posts / frame
    doorSteel:'#5e6772',  // a reinforced (blast-proof) door
    doorSteelFrame:'#3a4048',
    glass:   'rgba(140,195,225,0.30)',  // intact window pane
    glassEdge:'rgba(175,215,240,0.75)', // window mullions / frame
    // decor objects (cover). Low cover = crate/desk; tall cover = locker/console.
    crateTop:  '#7a6242',  // crate lid (lighter top face)
    crateBody: '#5f4c34',  // crate sides
    crateEdge: 'rgba(0,0,0,0.38)',
    crateBrace:'#8a6e49',  // the X-brace banding
    deskTop:   '#6a5942',  // desk surface
    deskLeg:   '#3f3527',  // desk legs
    lockerBody:'#49545f',  // tall steel locker
    lockerEdge:'#2c343c',
    lockerHandle:'#8d99a6',
    consoleBody:'#3a4048',          // machinery console
    consoleEdge:'#262b31',
    consoleScreen:'rgba(90,200,170,0.45)', // dim teal screen glow (kept low so overlays still read)
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
