// level.js — one level, expressed purely as data. New maps = new objects like this.
// Map legend:  '#' wall (blocks move + sight)   '.' exterior ground   '_' interior floor   'D' doorway (passable)
LS.level = {
  name: 'Sector 7 — Compound Raid',
  brief: 'Blue squad breaches the compound from the west. Red squad holds inside. Wipe out the opposing squad.',
  // legend: # reinforced wall   x breakable wall   . ground   _ floor
  //         D door (destructible)   R reinforced door (blast-proof)   W window
  // Doors start closed. Breakable walls/doors blow to rubble; reinforced ones hold.
  map: [
    '................',
    '......##########',
    '......#____x___#',
    '......W____x___#',
    '..x...D____x___#',
    '..x...#____R___#',
    '......#____x___#',
    '...x..D____x___#',
    '..x...W____W___#',
    '......#____x___#',
    '......##xx######',
    '................',
  ],
  // facing: 2 = East (attackers look in), 6 = West (defenders look out)
  units: [
    { id: 'b1', team: 'blue', name: 'Cole',   x: 1, y: 1,  facing: 2 },
    { id: 'b2', team: 'blue', name: 'Vance',  x: 1, y: 4,  facing: 2 },
    { id: 'b3', team: 'blue', name: 'Rourke', x: 1, y: 7,  facing: 2 },
    { id: 'b4', team: 'blue', name: 'Diaz',   x: 1, y: 10, facing: 2 },
    { id: 'r1', team: 'red',  name: 'Krang',  x: 8,  y: 3, facing: 6 },
    { id: 'r2', team: 'red',  name: 'Sora',   x: 9,  y: 8, facing: 6 },
    { id: 'r3', team: 'red',  name: 'Mott',   x: 13, y: 3, facing: 6 },
    { id: 'r4', team: 'red',  name: 'Vex',    x: 13, y: 8, facing: 6 },
  ],
  weapon: { name: 'Laser Rifle', fireCost: 8, dmgMin: 3, dmgMax: 6, range: 12 },
  unitHp: 10,
};
