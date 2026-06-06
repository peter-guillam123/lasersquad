// los.js — line of sight & line of fire. Crucially these block differently:
// glass is see-through but not shoot-through, so sight and shot use separate predicates.
LS.los = (function () {
  const k = (x, y) => y * LS.config.cols + x;

  function tileChar(x, y) {
    if (x < 0 || y < 0 || x >= LS.config.cols || y >= LS.config.rows) return '#';
    return LS.level.map[y][x];
  }
  function rubbled(x, y) { return !!(LS.state && LS.state.rubble && LS.state.rubble.has(k(x, y))); }
  function cratered(x, y) { return !!(LS.state && LS.state.craters && LS.state.craters.has(k(x, y))); }
  function isWall(x, y) { return tileChar(x, y) === '#'; }          // reinforced wall
  function isBreakable(x, y) { return tileChar(x, y) === 'x' && !rubbled(x, y); }
  function isDoor(x, y) { const c = tileChar(x, y); return !rubbled(x, y) && (c === 'D' || c === 'R'); }
  function isReinforcedDoor(x, y) { return tileChar(x, y) === 'R'; }
  function isWindow(x, y) { return tileChar(x, y) === 'W'; }
  function isBarrier(x, y) { const c = tileChar(x, y); return c === '#' || c === 'x' || c === 'D' || c === 'R' || c === 'W'; }
  function doorOpen(x, y) { return !!(LS.state && LS.state.doorsOpen && LS.state.doorsOpen.has(k(x, y))); }
  function windowSmashed(x, y) { return !!(LS.state && LS.state.windowsSmashed && LS.state.windowsSmashed.has(k(x, y))); }

  // decor objects sit on the floor. Each gives cover; all block movement; only the tall ones
  // (locker, console) block sight & fire — crates and desks you can see and shoot over.
  const DECOR = {
    c: { sight: false, shot: false }, // crate  — low cover
    t: { sight: false, shot: false }, // desk/table — low cover
    b: { sight: false, shot: false }, // bed    — low cover
    L: { sight: true,  shot: true  }, // locker — tall cover
    M: { sight: true,  shot: true  }, // console/machinery — tall cover
    T: { sight: true,  shot: true  }, // tree   — tall cover (outdoors)
    s: { sight: false, shot: false }, // shrub  — low cover (outdoors)
  };
  const OUTDOOR_DECOR = new Set(['T', 's']); // sits on grass, not floor
  function isOutdoorDecor(x, y) { return OUTDOOR_DECOR.has(tileChar(x, y)); }
  function decorAt(x, y) { return DECOR[tileChar(x, y)] || null; }
  function isDecor(x, y) { return !!DECOR[tileChar(x, y)]; }

  // a thing that shields a target — used for cover (reinforced/breakable wall, or any decor object)
  function givesCover(x, y) { if (rubbled(x, y)) return false; const c = tileChar(x, y); return c === '#' || c === 'x' || !!DECOR[c]; }

  // walls and closed doors block sight; windows & low cover are see-through; rubble/craters don't block
  function blocksSight(x, y) {
    if (rubbled(x, y)) return false;
    const c = tileChar(x, y);
    if (c === '#' || c === 'x') return true;
    if (c === 'D' || c === 'R') return !doorOpen(x, y);
    return !!(DECOR[c] && DECOR[c].sight);
  }
  // as sight, plus intact windows and tall decor stop a shot
  function blocksShot(x, y) {
    if (rubbled(x, y)) return false;
    const c = tileChar(x, y);
    if (c === '#' || c === 'x') return true;
    if (c === 'D' || c === 'R') return !doorOpen(x, y);
    if (c === 'W') return !windowSmashed(x, y);
    return !!(DECOR[c] && DECOR[c].shot);
  }
  // anything that stops a body: walls, windows, closed doors, decor, AND craters (a hole you can't cross)
  function blocksMove(x, y) {
    if (cratered(x, y)) return true;
    if (rubbled(x, y)) return false;
    const c = tileChar(x, y);
    if (c === '#' || c === 'x' || c === 'W') return true;
    if (c === 'D' || c === 'R') return !doorOpen(x, y);
    return !!DECOR[c]; // every decor object blocks movement (you can't stand on a crate)
  }

  // Bresenham; false if `blocks` is true for any tile strictly between the endpoints
  function lineClear(x0, y0, x1, y1, blocks) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, cx = x0, cy = y0;
    while (true) {
      const isEnd = (cx === x0 && cy === y0) || (cx === x1 && cy === y1);
      if (!isEnd && blocks(cx, cy)) return false;
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return true;
  }

  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  // can the unit land a shot on this square? range + shot-clear (also used to shoot a window: the
  // target tile is an endpoint, so the window itself isn't counted as a blocker)
  function canTarget(unit, tx, ty) {
    if (dist(unit.x, unit.y, tx, ty) > LS.config.combat.sightRange) return false;
    return lineClear(unit.x, unit.y, tx, ty, blocksShot);
  }
  // passive vision: range + forward arc + sight-clear (windows transparent)
  function canSee(unit, tx, ty) {
    const dx = tx - unit.x, dy = ty - unit.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return true;
    if (d > LS.config.combat.sightRange) return false;
    const f = LS.DIRS[unit.facing];
    const dot = (f.dx * dx + f.dy * dy) / (Math.hypot(f.dx, f.dy) * d);
    if (dot < Math.cos(LS.config.combat.arcHalfDeg * Math.PI / 180)) return false;
    return lineClear(unit.x, unit.y, tx, ty, blocksSight);
  }

  // the first tile (between the endpoints) that stops a shot, or null if the line is clear
  function firstShotBlocker(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, cx = x0, cy = y0;
    while (true) {
      const isEnd = (cx === x0 && cy === y0) || (cx === x1 && cy === y1);
      if (!isEnd && blocksShot(cx, cy)) return { x: cx, y: cy, char: tileChar(cx, cy) };
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return null;
  }

  return {
    tileChar, isWall, isBreakable, isDoor, isReinforcedDoor, isWindow, isBarrier, isDecor, decorAt, isOutdoorDecor,
    doorOpen, windowSmashed, rubbled, cratered, givesCover,
    blocksSight, blocksShot, blocksMove, lineClear, dist, canTarget, canSee, firstShotBlocker,
  };
})();
