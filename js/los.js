// los.js — line of sight & line of fire. Crucially these block differently:
// glass is see-through but not shoot-through, so sight and shot use separate predicates.
LS.los = (function () {
  const k = (x, y) => y * LS.config.cols + x;

  function tileChar(x, y) {
    if (x < 0 || y < 0 || x >= LS.config.cols || y >= LS.config.rows) return '#';
    return LS.level.map[y][x];
  }
  function isWall(x, y) { return tileChar(x, y) === '#'; }
  function isDoor(x, y) { return tileChar(x, y) === 'D'; }
  function isWindow(x, y) { return tileChar(x, y) === 'W'; }
  function isBarrier(x, y) { const c = tileChar(x, y); return c === '#' || c === 'D' || c === 'W'; }
  function doorOpen(x, y) { return !!(LS.state && LS.state.doorsOpen && LS.state.doorsOpen.has(k(x, y))); }
  function windowSmashed(x, y) { return !!(LS.state && LS.state.windowsSmashed && LS.state.windowsSmashed.has(k(x, y))); }

  // walls and closed doors block sight; windows (intact or smashed) are see-through
  function blocksSight(x, y) {
    const c = tileChar(x, y);
    if (c === '#') return true;
    if (c === 'D') return !doorOpen(x, y);
    return false;
  }
  // walls, closed doors AND intact windows block a shot; a smashed window doesn't
  function blocksShot(x, y) {
    const c = tileChar(x, y);
    if (c === '#') return true;
    if (c === 'D') return !doorOpen(x, y);
    if (c === 'W') return !windowSmashed(x, y);
    return false;
  }
  // anything that stops a body: walls, any window, a closed door
  function blocksMove(x, y) {
    const c = tileChar(x, y);
    if (c === '#' || c === 'W') return true;
    if (c === 'D') return !doorOpen(x, y);
    return false;
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

  return {
    tileChar, isWall, isDoor, isWindow, isBarrier, doorOpen, windowSmashed,
    blocksSight, blocksShot, blocksMove, lineClear, dist, canTarget, canSee,
  };
})();
