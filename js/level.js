// level.js — one level, expressed purely as data. New maps = new objects like this.
// Map legend:  '#' wall (blocks move + sight)   '.' exterior ground   '_' interior floor   'D' doorway (passable)
LS.level = {
  name: 'Sector 7 — Compound Raid',
  brief: 'Blue squad breaches the compound from the west. Red squad holds inside. Wipe out the opposing squad.',
  // legend: # reinforced wall   x breakable wall   . ground   _ floor
  //         D door (destructible)   R reinforced door (blast-proof)   W window
  //         c crate / t desk = low cover (see & shoot over)
  //         L locker / M console = tall cover (also blocks sight & fire)
  // 26 x 18 — bigger than the screen, so the camera scrolls. Compound on the right, open approach on the left.
  map: [
    '..........................',
    '..........................',
    '..........................',
    '..........................',
    '................##D####W##',
    '................#L___x__M#',
    '................W____x___#',
    '............x...D____x___#',
    '............x...#____R__M#',
    '................#_cc_xc__#',
    '.............x..D____x___#',
    '............x...W____W___#',
    '................#___tx_t_#',
    '................##xx####D#',
    '..........................',
    '..........................',
    '..........................',
    '..........................',
  ],
  // facing: 2 = East (attackers look in), 6 = West (defenders look out)
  units: [
    { id: 'b1', team: 'blue', name: 'Cole',   x: 2, y: 5,  facing: 2 },
    { id: 'b2', team: 'blue', name: 'Vance',  x: 2, y: 8,  facing: 2 },
    { id: 'b3', team: 'blue', name: 'Rourke', x: 2, y: 11, facing: 2 },
    { id: 'b4', team: 'blue', name: 'Diaz',   x: 2, y: 14, facing: 2 },
    { id: 'r1', team: 'red',  name: 'Krang',  x: 18, y: 6,  facing: 6 },
    { id: 'r2', team: 'red',  name: 'Sora',   x: 19, y: 11, facing: 6 },
    { id: 'r3', team: 'red',  name: 'Mott',   x: 23, y: 6,  facing: 6 },
    { id: 'r4', team: 'red',  name: 'Vex',    x: 23, y: 11, facing: 6 },
  ],
  weapon: { name: 'Laser Rifle', fireCost: 8, dmgMin: 3, dmgMax: 6, range: 12 },
  unitHp: 10,
};
