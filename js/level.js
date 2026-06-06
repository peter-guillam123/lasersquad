// level.js — one level, expressed purely as data. New maps = new objects like this.
// Map legend:
//   # reinforced wall   x breakable wall   . grass/ground   _ interior floor
//   D door (destructible)   R reinforced door (blast-proof)   W window
//   c crate / t table / b bed = low cover    L locker / M console = tall cover
//   T tree (tall cover) / s shrub (low cover) — outdoor
// 44 x 32, scrolls. 'The Assassins': blue breaches the estate from the west; red holds the mansion.
LS.level = {
  name: '1 — The Assassins',
  brief: 'Blue squad breaches the estate from the west. Red squad holds the mansion. Wipe out the opposing squad.',
  map: [
    '............................................',
    '............................................',
    '........######################D############.',
    '........#.....................T.......T...#.',
    '..T.....#......T.................T........#.',
    '......T.#...T...........................T.#.',
    '...s....#.................................#.',
    '....T...#....s......####W##x###W##x##W###.#.',
    '........#...........#______x______x_____#.#.',
    '......s.#..T........#______x__b_b_x__M__#.#.',
    '.....s..#...........W__tt__D______D_____#.#.',
    '...T....#......s....#_M____x___t__x___L_W.#.',
    '........#..sT.......#______x______x_____#.#.',
    '........#...........xxxDxxxxxxDxxxxxxDxxx.#.',
    '..s.....#......T....#______x______x_____#.#.',
    '.....T..D...........#______x______x__M__#.#.',
    '........D..s....s...D_cc___D__tt__D_____#.#.',
    '........#...........#___L__x____b_x___M_W.#.',
    '....s...#....T......#______x______x_____#.#.',
    '..T.....#...........xxxDxxxxxxDxxxxxxDxxx.#.',
    '.....s..#...........#______x______x_____#.#.',
    '........#...........#______x______x_____#.#.',
    '...s....#...s...T...W_b____D__c___D__L__#.#.',
    '....T...#...........#___t__x____c_x___M_#.#.',
    '........#.....s.....#______x______x_____#.#.',
    '.....T..#..T........#######xW#D###x#W####.#.',
    '........#.................................#.',
    '...T....#.....T..................s..T..T..#.',
    '........#.................................#.',
    '........############D######################.',
    '............................................',
    '............................................',
  ],
  // facing: 2 = East (attackers look in), 6 = West (defenders look out)
  units: [
    { id: 'b1', team: 'blue', name: 'Cole', x: 1, y: 9, facing: 2 },
    { id: 'b2', team: 'blue', name: 'Vance', x: 1, y: 12, facing: 2 },
    { id: 'b3', team: 'blue', name: 'Rourke', x: 1, y: 15, facing: 2 },
    { id: 'b4', team: 'blue', name: 'Diaz', x: 1, y: 18, facing: 2 },
    { id: 'b5', team: 'blue', name: 'Pike', x: 2, y: 21, facing: 2 },
    { id: 'b6', team: 'blue', name: 'Nash', x: 2, y: 24, facing: 2 },
    { id: 'r1', team: 'red',  name: 'Krang', x: 22, y: 9, facing: 6 },
    { id: 'r2', team: 'red',  name: 'Sora', x: 25, y: 11, facing: 6 },
    { id: 'r3', team: 'red',  name: 'Mott', x: 31, y: 15, facing: 6 },
    { id: 'r4', team: 'red',  name: 'Vex', x: 37, y: 16, facing: 6 },
    { id: 'r5', team: 'red',  name: 'Drel', x: 23, y: 22, facing: 6 },
    { id: 'r6', team: 'red',  name: 'Zane', x: 31, y: 23, facing: 6 },
  ],
  weapon: { name: 'Laser Rifle', fireCost: 8, dmgMin: 3, dmgMax: 6, range: 12 },
  unitHp: 10,
};
