// level.js — one level, expressed purely as data. New maps = new objects like this.
// Map legend:
//   # reinforced wall   x breakable wall   . grass/ground   _ interior floor
//   D door (destructible)   R reinforced door (blast-proof)   W window
//   c crate / t table / b bed / p plant = low cover    L locker / M console = tall cover
//   T tree (tall cover) / s shrub (low cover)    f flowerbed / r reeds (passable decoration)
// 44 x 32, scrolls. 'The Assassins': blue breaches the estate from the west; red holds the mansion.
LS.level = {
  name: '1 — The Assassins',
  brief: 'Yellow squad breaches the estate from the west. Red squad holds the mansion. Wipe out the opposing squad.',
  map: [
    '............................................',
    '............................................',
    '........######################D############.',
    '........#.....................Tf...f..T...#.',
    '..T.....#......T.................T........#.',
    '......T.#...T.f.......................r.T.#.',
    '..rs....#.................................#.',
    '....T.f.#....s......####W##x###W##x##W###.#.',
    '........#...........#______x______x_____#.#.',
    '...f..s.#..T.f......#____p_x__b_b_x__M__#.#.',
    '.....s..#...........W__tt__D______D_____#.#.',
    '...Tr...#......s....#_M____x___t__x___L_W.#.',
    '........#..sT.......#______x_____px_____#.#.',
    '.....fr.#....r......xxxDxxxxxxDxxxxxxDxxx.#.',
    '..s.....#......T....#______x______x_____#.#.',
    '...r.T..D...f.......#______x______x__M__#.#.',
    '........D..s....s...D_cc___D__tt__D_____#.#.',
    '..f.....#......f....#___L__x____b_x___M_W.#.',
    '....sr..#....T......#____p_x______x_p___#.#.',
    '..T.....#...r.......xxxDxxxxxxDxxxxxxDxxx.#.',
    '.....s..#......r....#______x______x_____#.#.',
    '....f...#...........#______x______x_____#.#.',
    '...s....#..fs...T...W_b____D__c___D__L__#.#.',
    '..r.T...#...........#___t__x____c_x___M_#.#.',
    '........#.....s.....#____p_x_____px_____#.#.',
    '.....T..#..T........#######xW#D###x#W####.#.',
    '........#.................................#.',
    '...T....#.....T..................s..T..T..#.',
    '........#......................r.f.r.f....#.',
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
    { id: 'r1', team: 'red',  name: 'Krang', x: 22, y: 9, facing: 6, patrol: true, weapon: 'laser' },
    { id: 'r2', team: 'red',  name: 'Sora', x: 25, y: 11, facing: 6, weapon: 'pistol' },
    { id: 'r3', team: 'red',  name: 'Mott', x: 31, y: 15, facing: 6, weapon: 'plasma' },
    { id: 'r4', team: 'red',  name: 'Vex', x: 37, y: 16, facing: 6, weapon: 'laser' },
    { id: 'r5', team: 'red',  name: 'Drel', x: 23, y: 22, facing: 6, patrol: true, weapon: 'laser' },
    { id: 'r6', team: 'red',  name: 'Zane', x: 31, y: 23, facing: 6, weapon: 'plasma' },
  ],
  unitHp: 10,
  budget: 280, // credits the player spends arming the squad in the equip phase
};
