// los.js — line of sight: what blocks what, and who can see/shoot whom.
LS.los = (function () {
  function tileChar(x, y) {
    if (x < 0 || y < 0 || x >= LS.config.cols || y >= LS.config.rows) return '#';
    return LS.level.map[y][x];
  }
  function isWall(x, y) { return tileChar(x, y) === '#'; }

  // Bresenham line; false if a wall sits strictly between the two endpoints.
  function lineClear(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, cx = x0, cy = y0;
    while (true) {
      const isEnd = (cx === x0 && cy === y0) || (cx === x1 && cy === y1);
      if (!isEnd && isWall(cx, cy)) return false;
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx) { err += dx; cy += sy; }
    }
    return true;
  }

  function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

  // Can the unit shoot this square? Range + clear line. Facing is ignored because
  // turning to fire is free in this build — you'd simply pivot before pulling the trigger.
  function canTarget(unit, tx, ty) {
    if (dist(unit.x, unit.y, tx, ty) > LS.config.combat.sightRange) return false;
    return lineClear(unit.x, unit.y, tx, ty);
  }

  // Passive vision (range + clear line + forward arc). Tracked for later; not yet gating anything.
  function canSee(unit, tx, ty) {
    const dx = tx - unit.x, dy = ty - unit.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return true;
    if (d > LS.config.combat.sightRange) return false;
    const f = LS.DIRS[unit.facing];
    const dot = (f.dx * dx + f.dy * dy) / (Math.hypot(f.dx, f.dy) * d);
    if (dot < Math.cos(LS.config.combat.arcHalfDeg * Math.PI / 180)) return false;
    return lineClear(unit.x, unit.y, tx, ty);
  }

  return { isWall, lineClear, canTarget, canSee, dist };
})();
