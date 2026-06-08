// render.js — draws game state to SVG. Board is rebuilt on each state change (cheap at this size).
LS.render = (function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  let svg, layers = {};
  const unitEls = {};   // id -> <g>, used by the movement animation

  function el(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function init() {
    svg = document.getElementById('board');
    // 'threat' sits above 'overlay' so enemy danger reads red over the blue move-field, not muddy purple.
    // 'fx' is topmost and is NOT cleared by draw(), so floating damage numbers survive a redraw.
    buildPatterns();   // reusable grass/floor fills (defined once, keeps a big board cheap)
    ['terrain', 'fog', 'overlay', 'threat', 'units', 'facing', 'hover', 'fx'].forEach(name => {
      layers[name] = el('g', { id: 'layer-' + name }, svg);
    });
    setCamera(LS.state.cam.x, LS.state.cam.y); // the viewBox is a window onto the (possibly larger) map
  }

  // grass = dark soil + scattered green flecks (over a 4-tile span so it doesn't visibly repeat per cell);
  // floor = dark tile + a blue grout grid. Patterns tile in world space, so they hold still as the camera pans.
  function buildPatterns() {
    const T = LS.config.tile, C = LS.config.colors;
    const defs = el('defs', {}, svg);
    const grass = el('pattern', { id: 'grass', patternUnits: 'userSpaceOnUse', width: T * 4, height: T * 4 }, defs);
    el('rect', { x: 0, y: 0, width: T * 4, height: T * 4, fill: C.grassBase }, grass);
    for (let i = 0; i < 150; i++) {
      const fx = Math.random() * T * 4, fy = Math.random() * T * 4;
      el('circle', { cx: fx, cy: fy, r: 0.5 + Math.random() * 1.3, fill: Math.random() < 0.5 ? C.grassFleckA : C.grassFleckB, opacity: 0.45 + Math.random() * 0.5 }, grass);
    }
    const floor = el('pattern', { id: 'floor', patternUnits: 'userSpaceOnUse', width: T, height: T }, defs);
    el('rect', { x: 0, y: 0, width: T, height: T, fill: C.floorBase }, floor);
    el('path', { d: `M0 ${T} H${T} V0`, fill: 'none', stroke: C.floorGrid, 'stroke-width': 1, 'stroke-dasharray': '3 4' }, floor);
  }

  // --- camera: the SVG viewBox is a window onto the world; panning just moves it (no re-render) ---
  function setCamera(x, y) {
    const T = LS.config.tile, V = LS.config.view;
    const worldW = LS.config.cols * T, worldH = LS.config.rows * T, viewW = V.cols * T, viewH = V.rows * T;
    const cx = worldW <= viewW ? (worldW - viewW) / 2 : Math.max(0, Math.min(x, worldW - viewW));
    const cy = worldH <= viewH ? (worldH - viewH) / 2 : Math.max(0, Math.min(y, worldH - viewH));
    LS.state.cam.x = cx; LS.state.cam.y = cy;
    svg.setAttribute('viewBox', `${cx} ${cy} ${viewW} ${viewH}`);
  }
  function centerOn(wx, wy) { const T = LS.config.tile, V = LS.config.view; setCamera(wx - V.cols * T / 2, wy - V.rows * T / 2); }
  function panBy(dx, dy) { setCamera(LS.state.cam.x + dx, LS.state.cam.y + dy); }
  // recentre on a unit only if it's near/past the visible edge (keeps the action on screen without jitter).
  // smooth=true glides there (used on selection, so picking a soldier doesn't hard-cut the board);
  // the move animation tracks instantly (smooth off) so a fast walk stays glued to the camera.
  function followUnit(u, smooth) {
    const T = LS.config.tile, V = LS.config.view, cam = LS.state.cam;
    const wx = u.x * T + T / 2, wy = u.y * T + T / 2, m = 2.5 * T;
    if (wx < cam.x + m || wx > cam.x + V.cols * T - m || wy < cam.y + m || wy > cam.y + V.rows * T - m) {
      if (smooth) panToCenter(wx, wy, 300); else centerOn(wx, wy);
    }
  }

  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // is a world point currently within the visible window (with a tile of margin)?
  function inView(wx, wy) {
    const T = LS.config.tile, V = LS.config.view, cam = LS.state.cam, m = T;
    return wx >= cam.x + m && wx <= cam.x + V.cols * T - m && wy >= cam.y + m && wy <= cam.y + V.rows * T - m;
  }
  // tween the camera to centre on a world point (instant if motion is reduced / anim off)
  function panToCenter(wx, wy, ms, done) {
    const T = LS.config.tile, V = LS.config.view;
    const tx = wx - V.cols * T / 2, ty = wy - V.rows * T / 2;
    if (reduceMotion() || !LS.config.anim.enabled || ms <= 0) { setCamera(tx, ty); done && done(); return; }
    const x0 = LS.state.cam.x, y0 = LS.state.cam.y;
    let start = null;
    requestAnimationFrame(function f(t) {
      if (start === null) start = t;
      let p = (t - start) / ms; if (p > 1) p = 1;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // ease in-out
      setCamera(x0 + (tx - x0) * e, y0 + (ty - y0) * e);
      if (p < 1) requestAnimationFrame(f); else { done && done(); }
    });
  }
  // a pulsing red ring to call out a newly spotted enemy
  function flashContact(x, y) {
    const T = LS.config.tile, cx = x * T + T / 2, cy = y * T + T / 2;
    const ring = el('circle', { cx, cy, r: T * 0.2, fill: 'none', stroke: LS.config.colors.red, 'stroke-width': 3, opacity: 0.95 }, layers.fx);
    el('animate', { attributeName: 'r', values: `${T * 0.2};${T * 0.62};${T * 0.2}`, dur: '0.7s', repeatCount: '2' }, ring);
    el('animate', { attributeName: 'opacity', values: '0.95;0.25;0.95', dur: '0.7s', repeatCount: '2' }, ring);
    setTimeout(() => ring.remove(), 1500);
  }
  // bring a tile into view if it isn't already (used by the AI to show an off-screen shot)
  function focusTile(x, y, done) {
    const T = LS.config.tile, wx = x * T + T / 2, wy = y * T + T / 2;
    if (inView(wx, wy)) { done && done(); return; }
    panToCenter(wx, wy, 360, done);
  }

  // "contact!" — the walk has halted on spotting an enemy. Flash it; if it's off-screen,
  // scroll to it and back to the soldier; if it's already on screen, just hold a beat.
  function contactMoment(unit, contacts, done) {
    draw(); // paint the board first so the newly-spotted enemy is on screen before the camera arrives
    LS.sound.play('contact');
    const T = LS.config.tile;
    const primary = contacts.slice().sort((a, b) =>
      Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y))[0];
    contacts.forEach(c => flashContact(c.x, c.y));
    const ex = primary.x * T + T / 2, ey = primary.y * T + T / 2;
    const ux = unit.x * T + T / 2, uy = unit.y * T + T / 2;
    const dwell = 850;
    if (reduceMotion()) { // no sliding: jump-cut to the enemy only if it's off-screen, then back
      const off = !inView(ex, ey);
      if (off) centerOn(ex, ey);
      setTimeout(() => { if (off) centerOn(ux, uy); done(); }, dwell);
    } else if (inView(ex, ey)) {
      setTimeout(done, dwell); // already on screen — hold a beat on the flash
    } else {
      panToCenter(ex, ey, 420, () => setTimeout(() => panToCenter(ux, uy, 380, done), dwell));
    }
  }

  function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  let vision = new Set(), danger = new Set();   // active team's current sight + known danger (set in draw)

  // the "intruder spotted" call-out: banner + radio static + a spoken line, fired once on the
  // calm->alert edge (staged in game.js, drained here so it lands the instant you're rumbled)
  const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  let alertBannerTimer = null;
  function flushAlertCallout() {
    const a = LS.state.alert && LS.state.alert.red;
    if (!a || !a.pendingCallout) return;
    const { kind, sector: sec } = a.pendingCallout;
    a.pendingCallout = null;
    const word = NUM_WORD[sec] || sec;
    const anomaly = kind === 'anomaly';
    const banner = document.getElementById('alert-banner');
    if (banner) {
      banner.textContent = anomaly
        ? `◆ ANOMALY · SECTOR ${sec} · INVESTIGATING`
        : `⚠ INTRUDER SPOTTED · SECTOR ${sec} · ALERT STATUS`;
      banner.classList.toggle('anomaly', anomaly);
      banner.classList.add('show');
      clearTimeout(alertBannerTimer);
      alertBannerTimer = setTimeout(() => banner.classList.remove('show'), anomaly ? 3000 : 3600);
    }
    if (anomaly) {
      LS.sound.play('radio'); // a quiet comms click — just a lone guard checking it out
      LS.sound.speak(`Anomaly spotted. Sector ${word}. Investigating.`);
      LS.game.log(`◆ A guard is investigating something in sector ${sec}.`);
    } else {
      LS.sound.play('alarm'); // a klaxon — the whole squad to full combat alert
      LS.sound.speak(`Contact! Intruder in sector ${word}. All units, engage.`);
      LS.game.log(`⚠ Red squad on full alert — intruder in sector ${sec}.`);
    }
  }

  function draw() {
    flushAlertCallout(); // a guard may have just clocked you — sound the klaxon before we repaint
    const T = LS.config.tile, C = LS.config.colors;
    const vt = LS.game.viewTeam();
    vision = LS.game.teamVision(vt);
    danger = LS.game.enemyDangerSet(vt, vision);
    drawTerrain(T, C);
    drawFog(T, C);
    clear(layers.threat);
    drawOverlay(T, C);
    drawUnits(T, C);
    drawFacing(-1);
    clear(layers.hover);
    if (watchAll) renderAiLabel(); // keep the debug caption pinned above the acting unit
    LS.ui.update();
  }

  // veil every tile the active squad can't currently see
  function drawFog(T, C) {
    clear(layers.fog);
    if (watchAll) return; // debug: watching the AI — the whole board is lit
    for (let y = 0; y < LS.config.rows; y++)
      for (let x = 0; x < LS.config.cols; x++)
        if (!vision.has(LS.game.key(x, y)))
          el('rect', { x: x * T, y: y * T, width: T, height: T, fill: C.fog }, layers.fog);
  }

  // ring of 8 clickable arrows around the selected soldier, for turning on the spot
  function drawFacing(hoverDir) {
    clear(layers.facing);
    const u = LS.game.selected();
    if (!u || u.team !== LS.state.activeTeam || LS.state.busy || LS.state.over) return;
    const T = LS.config.tile, C = LS.config.colors;
    const cx = u.x * T + T / 2, cy = u.y * T + T / 2, R = T * 0.56;
    for (let d = 0; d < 8; d++) {
      const dir = LS.DIRS[d], len = Math.hypot(dir.dx, dir.dy);
      const ux = dir.dx / len, uy = dir.dy / len;
      const ang = Math.atan2(uy, ux) * 180 / Math.PI;
      const isCur = d === u.facing, isHover = d === hoverDir;
      const sz = isHover ? 7.5 : 6;
      const g = el('g', { transform: `translate(${cx + ux * R},${cy + uy * R}) rotate(${ang})` }, layers.facing);
      el('polygon', {
        points: `${sz},0 ${-sz * 0.65},${-sz * 0.8} ${-sz * 0.65},${sz * 0.8}`,
        fill: isCur ? C.select : (isHover ? '#ffffff' : 'rgba(255,255,255,0.4)'),
        stroke: isCur ? '#7a5d00' : 'none', 'stroke-width': isCur ? 1 : 0,
      }, g);
    }

    // a ✕ badge on each open door orthogonally next to the soldier — click it to close (geometry mirrored in input.js)
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const x = u.x + dx, y = u.y + dy;
      if (LS.los.isDoor(x, y) && LS.los.doorOpen(x, y)) {
        const bx = x * T + T * 0.78, by = y * T + T * 0.22, r = T * 0.17;
        el('circle', { cx: bx, cy: by, r, fill: 'rgba(18,20,26,0.92)', stroke: C.select, 'stroke-width': 1.5 }, layers.facing);
        el('line', { x1: bx - r * 0.45, y1: by - r * 0.45, x2: bx + r * 0.45, y2: by + r * 0.45, stroke: C.select, 'stroke-width': 1.6, 'stroke-linecap': 'round' }, layers.facing);
        el('line', { x1: bx + r * 0.45, y1: by - r * 0.45, x2: bx - r * 0.45, y2: by + r * 0.45, stroke: C.select, 'stroke-width': 1.6, 'stroke-linecap': 'round' }, layers.facing);
      }
    });
  }

  function drawTerrain(T, C) {
    clear(layers.terrain);
    for (let y = 0; y < LS.config.rows; y++) {
      for (let x = 0; x < LS.config.cols; x++) {
        const ch = LS.level.map[y][x];
        const rubbled = LS.los.rubbled(x, y), cratered = LS.los.cratered(x, y);
        const decor = !rubbled && !cratered && LS.los.isDecor(x, y); // crate/desk/locker/console/bed/tree/shrub
        const outdoorDecor = decor && LS.los.isOutdoorDecor(x, y);    // trees/shrubs sit on grass
        const floorLike = ch === '_' || ch === 'D' || ch === 'R' || (decor && !outdoorDecor); // indoor decor sits on a floor
        const isWallTile = (ch === '#' || ch === 'x' || ch === 'W') && !rubbled;
        let base;
        if (rubbled) base = borderingInterior(x, y) ? 'url(#floor)' : 'url(#grass)'; // blown open
        else if (isWallTile) base = borderingInterior(x, y) ? 'url(#floor)' : 'url(#grass)'; // shows beside thin N-S walls
        else if (floorLike) base = 'url(#floor)';
        else base = 'url(#grass)';                               // '.' ground (grass)
        el('rect', { x: x * T, y: y * T, width: T, height: T, fill: base }, layers.terrain);

        if (rubbled) drawRubble(x, y, T, C);
        else if (cratered) drawCrater(x, y, T, C);
        else if (ch === '#') drawWall(x, y, T, C);
        else if (ch === 'x') drawBreakableWall(x, y, T, C);
        else if (ch === 'D' || ch === 'R') drawDoor(x, y, T, C, ch === 'R');
        else if (ch === 'W') drawWindow(x, y, T, C);
        else if (decor) drawDecor(x, y, T, C, ch);
        else if (ch === 'f') drawFlowerbed(x, y, T, C); // passable field flora
        else if (ch === 'r') drawReed(x, y, T, C);
      }
    }
  }

  // does this tile border the building interior? (decides the base shown beside a thin wall)
  function borderingInterior(x, y) {
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const c = LS.los.tileChar(x + dx, y + dy);
      return c === '_' || c === 'D' || c === 'R' || LS.los.rubbled(x + dx, y + dy);
    });
  }
  // which sides this wall/door/window joins onto (so walls connect into corners and doorways)
  function wallLink(x, y) {
    const S = (xx, yy) => { const c = LS.los.tileChar(xx, yy); return c === '#' || c === 'x' || c === 'W' || c === 'D' || c === 'R'; };
    return { n: S(x, y - 1), s: S(x, y + 1), w: S(x - 1, y), e: S(x + 1, y) };
  }
  // shared geometry so walls, doors and windows all sit on the same line
  const WALL = { vw: 0.42, hh: 0.60 }; // thin N-S strip width; thick E-W band height (fractions of a tile)

  // connection-aware stone wall: arms reach toward each wall neighbour — horizontal arms draw THICK
  // and faced (you see the wall's lit top + front), vertical arms draw THIN (seen edge-on). Corners,
  // T-junctions and crossings all join cleanly, no separate corner art needed.
  function stoneWall(x, y, T, cracked) {
    const C = LS.config.colors, cx = x * T, cy = y * T, L = wallLink(x, y);
    const vw = WALL.vw * T, vx = cx + (T - vw) / 2;            // vertical strip
    const hh = WALL.hh * T, hy = cy + (T - hh) / 2;            // horizontal band
    const coreT = hy, coreB = hy + hh, coreL = vx, coreR = vx + vw;
    if (L.n || L.s) {                                          // N-S strip (thin, edge-on)
      const y0 = L.n ? cy : coreT, y1 = L.s ? cy + T : coreB;
      el('rect', { x: vx, y: y0, width: vw, height: y1 - y0, fill: C.wallFace }, layers.terrain);
      el('rect', { x: vx, y: y0, width: vw * 0.3, height: y1 - y0, fill: C.wallTopLt, opacity: 0.5 }, layers.terrain);
      el('rect', { x: vx + vw * 0.72, y: y0, width: vw * 0.28, height: y1 - y0, fill: 'rgba(0,0,0,0.3)' }, layers.terrain);
      el('rect', { x: vx, y: y0, width: vw, height: y1 - y0, fill: 'none', stroke: C.wallEdge, 'stroke-width': 1 }, layers.terrain);
    }
    if (L.e || L.w) {                                          // E-W band (thick, faced)
      const x0 = L.w ? cx : coreL, x1 = L.e ? cx + T : coreR, bw = x1 - x0;
      el('rect', { x: x0, y: hy, width: bw, height: hh, fill: C.wallFace }, layers.terrain);
      el('rect', { x: x0, y: hy, width: bw, height: hh * 0.26, fill: C.wallTopLt }, layers.terrain);                // lit top
      el('rect', { x: x0, y: hy + hh * 0.84, width: bw, height: hh * 0.16, fill: 'rgba(0,0,0,0.28)' }, layers.terrain); // base shade
      el('line', { x1: x0, y1: hy + hh * 0.55, x2: x1, y2: hy + hh * 0.55, stroke: C.wallMortar, 'stroke-width': 1 }, layers.terrain);
      for (let mx = Math.ceil(x0 / (T * 0.5)) * (T * 0.5); mx < x1 - 2; mx += T * 0.5)
        el('line', { x1: mx, y1: hy + hh * 0.26, x2: mx, y2: hy + hh * 0.84, stroke: C.wallMortar, 'stroke-width': 1 }, layers.terrain);
      el('rect', { x: x0, y: hy, width: bw, height: hh, fill: 'none', stroke: C.wallEdge, 'stroke-width': 1 }, layers.terrain);
    }
    if (!L.n && !L.s && !L.e && !L.w) {                        // lone wall: a post
      el('rect', { x: coreL, y: coreT, width: vw, height: hh, fill: C.wallFace, stroke: C.wallEdge, 'stroke-width': 1 }, layers.terrain);
      el('rect', { x: coreL, y: coreT, width: vw, height: hh * 0.26, fill: C.wallTopLt }, layers.terrain);
    }
    if (cracked) el('polyline', { points: `${cx + T * 0.41},${coreT + 2} ${cx + T * 0.52},${cy + T * 0.5} ${cx + T * 0.43},${coreB - 2}`, fill: 'none', stroke: 'rgba(18,14,10,0.55)', 'stroke-width': 1.4 }, layers.terrain);
  }

  function drawWall(x, y, T, C) { stoneWall(x, y, T, false); }

  function drawBreakableWall(x, y, T, C) {
    stoneWall(x, y, T, true); // same grey as a solid wall; the crack marks it breakable
    const w = LS.state.wallHp && LS.state.wallHp.get(LS.game.key(x, y));
    if (w && w.hp < w.max) el('rect', { x: x * T, y: y * T, width: T, height: T, fill: 'rgba(0,0,0,0.24)' }, layers.terrain); // scorched but holding
  }

  function drawRubble(x, y, T, C) { // broken stone chunks of a blown wall, low and passable
    const cx = x * T, cy = y * T;
    [[0.24, 0.30, 0.20], [0.58, 0.34, 0.23], [0.40, 0.60, 0.21], [0.72, 0.64, 0.16], [0.22, 0.58, 0.15], [0.56, 0.74, 0.14]].forEach(([fx, fy, sz]) => {
      const x0 = cx + T * fx, y0 = cy + T * fy, s = T * sz;
      el('rect', { x: x0 + 1, y: y0 + 1.5, width: s, height: s * 0.8, rx: 1.5, fill: 'rgba(0,0,0,0.38)' }, layers.terrain); // AO
      el('rect', { x: x0, y: y0, width: s, height: s * 0.8, rx: 1.5, fill: C.rubble }, layers.terrain);
      el('rect', { x: x0, y: y0, width: s, height: s * 0.32, rx: 1.5, fill: C.rubbleLt }, layers.terrain);                  // lit top
    });
  }

  function drawCrater(x, y, T, C) { // charred blast pit (impassable)
    const cx = x * T + T / 2, cy = y * T + T / 2;
    [[0.5, -0.42], [-0.46, 0.12], [0.44, 0.22], [-0.22, -0.44], [0.18, 0.46], [-0.44, -0.2]].forEach(([dx, dy]) =>
      el('circle', { cx: cx + T * dx, cy: cy + T * dy, r: T * 0.045, fill: C.craterEjecta, opacity: 0.75 }, layers.terrain)); // ejecta
    el('circle', { cx, cy, r: T * 0.44, fill: C.craterRim }, layers.terrain);            // charred raised rim
    el('circle', { cx, cy: cy + T * 0.03, r: T * 0.35, fill: C.crater }, layers.terrain); // pit (nudged down for depth)
    el('circle', { cx, cy: cy + T * 0.05, r: T * 0.2, fill: '#000', opacity: 0.6 }, layers.terrain); // deep centre
    el('path', { d: `M${cx - T * 0.3},${cy - T * 0.16} A ${T * 0.36} ${T * 0.36} 0 0 1 ${cx + T * 0.3},${cy - T * 0.16}`, fill: 'none', stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 2, 'stroke-linecap': 'round' }, layers.terrain); // top rim sheen
  }

  // doors/windows orient along the wall they sit in (barriers above & below => vertical wall run)
  // a wall stub (the wall running up to a door/window frame) in the chosen orientation
  function wallStub(x0, y0, w, h, faced, C) {
    el('rect', { x: x0, y: y0, width: w, height: h, fill: C.wallFace }, layers.terrain);
    if (faced) el('rect', { x: x0, y: y0, width: w, height: h * 0.26, fill: C.wallTopLt }, layers.terrain); // lit top for E-W
    el('rect', { x: x0, y: y0, width: w, height: h, fill: 'none', stroke: C.wallEdge, 'stroke-width': 1 }, layers.terrain);
  }

  // doors take the wall's orientation: thin in a N-S run, thick/faced in an E-W run. Gold (steel when reinforced).
  function drawDoor(x, y, T, C, reinforced) {
    const open = LS.los.doorOpen(x, y), cx = x * T, cy = y * T;
    const vertical = LS.los.isBarrier(x, y - 1) && LS.los.isBarrier(x, y + 1); // in a N-S wall
    const leaf = reinforced ? C.doorSteel : C.doorGold, frame = reinforced ? C.doorSteelFrame : C.doorGoldDk;
    if (vertical) {
      const vw = WALL.vw * T, vx = cx + (T - vw) / 2;
      wallStub(vx, cy, vw, T * 0.20, false, C); wallStub(vx, cy + T * 0.80, vw, T * 0.20, false, C);
      if (open) {
        el('rect', { x: vx, y: cy + T * 0.20, width: vw, height: T * 0.05, fill: frame }, layers.terrain);
        el('rect', { x: vx, y: cy + T * 0.75, width: vw, height: T * 0.05, fill: frame }, layers.terrain);
      } else {
        el('rect', { x: vx, y: cy + T * 0.22, width: vw, height: T * 0.56, fill: leaf, stroke: frame, 'stroke-width': 1.5 }, layers.terrain);
        el('line', { x1: vx, y1: cy + T * 0.5, x2: vx + vw, y2: cy + T * 0.5, stroke: frame, 'stroke-width': 1 }, layers.terrain);
        if (reinforced) [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([fx, fy]) => el('circle', { cx: vx + vw * fx, cy: cy + T * fy, r: T * 0.03, fill: frame }, layers.terrain));
      }
    } else {
      const hh = WALL.hh * T, hy = cy + (T - hh) / 2;
      wallStub(cx, hy, T * 0.20, hh, true, C); wallStub(cx + T * 0.80, hy, T * 0.20, hh, true, C);
      if (open) {
        el('rect', { x: cx + T * 0.20, y: hy, width: T * 0.05, height: hh, fill: frame }, layers.terrain);
        el('rect', { x: cx + T * 0.75, y: hy, width: T * 0.05, height: hh, fill: frame }, layers.terrain);
      } else {
        el('rect', { x: cx + T * 0.22, y: hy + hh * 0.1, width: T * 0.56, height: hh * 0.8, fill: leaf, stroke: frame, 'stroke-width': 1.5 }, layers.terrain);
        el('line', { x1: cx + T * 0.5, y1: hy + hh * 0.1, x2: cx + T * 0.5, y2: hy + hh * 0.9, stroke: frame, 'stroke-width': 1 }, layers.terrain);
        if (reinforced) [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(([fx, fy]) => el('circle', { cx: cx + T * fx, cy: hy + hh * fy, r: T * 0.03, fill: frame }, layers.terrain));
      }
    }
  }

  // windows take the wall orientation too; glass between two wall stubs, oriented thin or faced
  function drawWindow(x, y, T, C) {
    const smashed = LS.los.windowSmashed(x, y), cx = x * T, cy = y * T;
    const vertical = LS.los.isBarrier(x, y - 1) && LS.los.isBarrier(x, y + 1);
    const pane = smashed ? '#10131a' : C.glass, edge = C.glassEdge;
    const sw = smashed ? { 'stroke-dasharray': '2 3', 'stroke-width': 1.2 } : { 'stroke-width': 1.5 };
    if (vertical) {
      const vw = WALL.vw * T, vx = cx + (T - vw) / 2;
      wallStub(vx, cy, vw, T * 0.18, false, C); wallStub(vx, cy + T * 0.82, vw, T * 0.18, false, C);
      el('rect', Object.assign({ x: vx, y: cy + T * 0.18, width: vw, height: T * 0.64, fill: pane, stroke: edge }, sw), layers.terrain);
      if (!smashed) {
        el('line', { x1: vx, y1: cy + T * 0.5, x2: vx + vw, y2: cy + T * 0.5, stroke: edge, 'stroke-width': 1 }, layers.terrain);
        el('line', { x1: vx + vw * 0.25, y1: cy + T * 0.25, x2: vx + vw * 0.55, y2: cy + T * 0.42, stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, layers.terrain);
      }
    } else {
      const hh = WALL.hh * T, hy = cy + (T - hh) / 2;
      wallStub(cx, hy, T * 0.18, hh, true, C); wallStub(cx + T * 0.82, hy, T * 0.18, hh, true, C);
      el('rect', Object.assign({ x: cx + T * 0.18, y: hy + hh * 0.12, width: T * 0.64, height: hh * 0.76, fill: pane, stroke: edge }, sw), layers.terrain);
      if (!smashed) {
        el('line', { x1: cx + T * 0.5, y1: hy + hh * 0.12, x2: cx + T * 0.5, y2: hy + hh * 0.88, stroke: edge, 'stroke-width': 1 }, layers.terrain);
        el('line', { x1: cx + T * 0.26, y1: hy + hh * 0.28, x2: cx + T * 0.44, y2: hy + hh * 0.5, stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, layers.terrain);
      }
    }
  }

  function drawDecor(x, y, T, C, ch) {
    if (ch === 'c') drawCrate(x, y, T, C);
    else if (ch === 't') drawTable(x, y, T, C);
    else if (ch === 'b') drawBed(x, y, T, C);
    else if (ch === 'p') drawPlant(x, y, T, C);
    else if (ch === 'L') drawLocker(x, y, T, C);
    else if (ch === 'M') drawConsole(x, y, T, C);
    else if (ch === 'T') drawTree(x, y, T, C);
    else if (ch === 's') drawShrub(x, y, T, C);
  }

  function drawCrate(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.16, x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0 + 1, y: y0 + 2, width: w, height: h, rx: 2, fill: 'rgba(0,0,0,0.35)' }, layers.terrain); // AO
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.crateBody, stroke: C.crateEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.24, rx: 2, fill: C.crateTop }, layers.terrain); // lit lid
    el('line', { x1: x0, y1: y0 + h * 0.28, x2: x0 + w, y2: y0 + h, stroke: C.crateBrace, 'stroke-width': 2 }, layers.terrain); // X brace
    el('line', { x1: x0 + w, y1: y0 + h * 0.28, x2: x0, y2: y0 + h, stroke: C.crateBrace, 'stroke-width': 2 }, layers.terrain);
  }

  function drawTable(x, y, T, C) { // cyan dining table with grey chairs, like the original
    const cx = x * T, cy = y * T;
    [[0.30, 0.09], [0.57, 0.09], [0.30, 0.78], [0.57, 0.78]].forEach(([fx, fy]) =>
      el('rect', { x: cx + T * fx, y: cy + T * fy, width: T * 0.13, height: T * 0.13, rx: 2, fill: C.chair }, layers.terrain));
    const x0 = cx + T * 0.17, y0 = cy + T * 0.30, w = T * 0.66, h = T * 0.40;
    el('rect', { x: x0, y: y0 + 2, width: w, height: h, rx: 3, fill: 'rgba(0,0,0,0.3)' }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 3, fill: C.tableTop, stroke: C.tableLeg, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.32, rx: 3, fill: C.tableTopHi, opacity: 0.6 }, layers.terrain); // sheen
  }

  function drawBed(x, y, T, C) { // yellow bed
    const cx = x * T, cy = y * T, x0 = cx + T * 0.18, y0 = cy + T * 0.12, w = T * 0.64, h = T * 0.76;
    el('rect', { x: x0 + 1, y: y0 + 2, width: w, height: h, rx: 3, fill: 'rgba(0,0,0,0.3)' }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 3, fill: C.bedFrame }, layers.terrain);
    el('rect', { x: x0 + T * 0.04, y: y0 + T * 0.2, width: w - T * 0.08, height: h - T * 0.26, rx: 2, fill: C.bedSheet }, layers.terrain); // blanket
    el('rect', { x: x0 + T * 0.04, y: y0 + T * 0.2, width: w - T * 0.08, height: T * 0.1, fill: 'rgba(255,255,255,0.18)' }, layers.terrain); // sheen
    el('rect', { x: x0 + T * 0.06, y: y0 + T * 0.04, width: w - T * 0.12, height: T * 0.14, rx: 2, fill: C.bedPillow }, layers.terrain); // pillow
  }

  function drawPlant(x, y, T, C) { // potted plant (indoor)
    const cx = x * T + T / 2, cy = y * T + T * 0.62;
    el('path', { d: `M${cx - T * 0.13},${cy} L${cx + T * 0.13},${cy} L${cx + T * 0.1},${cy + T * 0.2} L${cx - T * 0.1},${cy + T * 0.2} Z`, fill: C.plantPot }, layers.terrain);
    el('circle', { cx: cx - T * 0.1, cy: cy - T * 0.05, r: T * 0.12, fill: C.plantLeaf }, layers.terrain);
    el('circle', { cx: cx + T * 0.1, cy: cy - T * 0.05, r: T * 0.12, fill: C.plantLeaf }, layers.terrain);
    el('circle', { cx: cx, cy: cy - T * 0.16, r: T * 0.14, fill: C.plantLeaf }, layers.terrain);
    el('circle', { cx: cx - T * 0.03, cy: cy - T * 0.19, r: T * 0.07, fill: C.plantLeafHi }, layers.terrain);
  }

  function drawLocker(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.13, x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.lockerBody, stroke: C.lockerEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.14, fill: 'rgba(255,255,255,0.12)' }, layers.terrain); // lit top
    el('line', { x1: x0 + w / 2, y1: y0, x2: x0 + w / 2, y2: y0 + h, stroke: C.lockerEdge, 'stroke-width': 1.5 }, layers.terrain);
    [0.34, 0.66].forEach(fx => el('rect', { x: x0 + w * fx - T * 0.015, y: y0 + h * 0.42, width: T * 0.03, height: h * 0.16, rx: 1, fill: C.lockerHandle }, layers.terrain));
  }

  function drawConsole(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.13, x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.consoleBody, stroke: C.consoleEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.14, fill: 'rgba(255,255,255,0.1)' }, layers.terrain); // lit top
    el('rect', { x: x0 + w * 0.16, y: y0 + h * 0.16, width: w * 0.68, height: h * 0.40, rx: 1, fill: '#0c0f12', stroke: C.consoleEdge, 'stroke-width': 1 }, layers.terrain);
    el('rect', { x: x0 + w * 0.16, y: y0 + h * 0.16, width: w * 0.68, height: h * 0.40, rx: 1, fill: C.consoleScreen }, layers.terrain); // teal screen
    [0.28, 0.42].forEach(fy => el('line', { x1: x0 + w * 0.18, y1: y0 + h * fy, x2: x0 + w * 0.82, y2: y0 + h * fy, stroke: 'rgba(0,0,0,0.22)', 'stroke-width': 1 }, layers.terrain));
    [0.32, 0.5, 0.68].forEach(fx => el('circle', { cx: x0 + w * fx, cy: y0 + h * 0.76, r: T * 0.03, fill: C.lockerHandle }, layers.terrain));
  }

  function drawTree(x, y, T, C) { // green canopy on the original's signature yellow forked trunk
    const cx = x * T + T / 2, cy = y * T + T / 2;
    el('ellipse', { cx: cx, cy: cy + T * 0.36, rx: T * 0.26, ry: T * 0.08, fill: 'rgba(0,0,0,0.28)' }, layers.terrain); // ground shadow
    el('path', { d: `M${cx},${cy + T * 0.08} L${cx},${cy + T * 0.44} M${cx},${cy + T * 0.22} L${cx - T * 0.13},${cy + T * 0.44} M${cx},${cy + T * 0.22} L${cx + T * 0.13},${cy + T * 0.44}`, fill: 'none', stroke: C.treeTrunk, 'stroke-width': T * 0.06, 'stroke-linecap': 'round' }, layers.terrain);
    el('circle', { cx: cx, cy: cy - T * 0.04, r: T * 0.32, fill: C.treeCanopy }, layers.terrain);
    el('circle', { cx: cx - T * 0.15, cy: cy + T * 0.02, r: T * 0.19, fill: C.treeCanopy2 }, layers.terrain);
    el('circle', { cx: cx + T * 0.15, cy: cy, r: T * 0.18, fill: C.treeCanopy2 }, layers.terrain);
    el('circle', { cx: cx - T * 0.03, cy: cy - T * 0.18, r: T * 0.15, fill: C.treeCanopyHi }, layers.terrain); // top highlight
  }

  function drawShrub(x, y, T, C) {
    const cx = x * T + T / 2, cy = y * T + T * 0.58;
    el('ellipse', { cx: cx, cy: cy + T * 0.18, rx: T * 0.2, ry: T * 0.06, fill: 'rgba(0,0,0,0.22)' }, layers.terrain);
    el('circle', { cx: cx - T * 0.14, cy: cy, r: T * 0.15, fill: C.shrubBody }, layers.terrain);
    el('circle', { cx: cx + T * 0.14, cy: cy, r: T * 0.15, fill: C.shrubBody }, layers.terrain);
    el('circle', { cx: cx, cy: cy - T * 0.08, r: T * 0.18, fill: C.shrubBody }, layers.terrain);
    el('circle', { cx: cx - T * 0.04, cy: cy - T * 0.12, r: T * 0.09, fill: C.shrubHi }, layers.terrain);
  }

  function drawReed(x, y, T, C) { // pale-cyan reed tuft (passable)
    const cx = x * T + T / 2, base = y * T + T * 0.8;
    [[-0.16, -0.34], [-0.07, -0.44], [0.03, -0.42], [0.13, -0.34], [-0.11, -0.28], [0.09, -0.26]].forEach(([bx, ty]) =>
      el('line', { x1: cx + T * bx, y1: base, x2: cx + T * (bx * 0.4), y2: base + T * ty, stroke: C.reedBlade, 'stroke-width': T * 0.045, 'stroke-linecap': 'round' }, layers.terrain));
    el('line', { x1: cx - T * 0.02, y1: base, x2: cx + T * 0.04, y2: base - T * 0.42, stroke: C.reedHi, 'stroke-width': T * 0.03, 'stroke-linecap': 'round' }, layers.terrain);
  }

  function drawFlowerbed(x, y, T, C) { // rows of little flowers (passable), colour varies by tile
    const cx = x * T, cy = y * T;
    const schemes = [['#ececf0', '#ecc83a'], ['#e85aa0', '#e85050'], ['#5ad0e8', '#c85ae8']];
    const sch = schemes[(x * 3 + y) % schemes.length];
    [[0.24, 0.32], [0.5, 0.26], [0.76, 0.34], [0.36, 0.56], [0.64, 0.58], [0.5, 0.78], [0.22, 0.74], [0.78, 0.72]].forEach(([fx, fy], i) => {
      el('line', { x1: cx + T * fx, y1: cy + T * fy, x2: cx + T * fx, y2: cy + T * (fy + 0.1), stroke: C.flowerStem, 'stroke-width': 1.2 }, layers.terrain);
      el('circle', { cx: cx + T * fx, cy: cy + T * fy, r: T * 0.05, fill: sch[i % 2] }, layers.terrain);
    });
  }

  function drawOverlay(T, C) {
    clear(layers.overlay);
    const sel = LS.game.selected();
    if (sel && !LS.state.busy) {
      if (LS.state.throwMode) {
        // grenade aiming: highlight every tile you can lob to
        const R = LS.config.grenade.range;
        for (let y = Math.max(0, sel.y - R); y <= Math.min(LS.config.rows - 1, sel.y + R); y++)
          for (let x = Math.max(0, sel.x - R); x <= Math.min(LS.config.cols - 1, sel.x + R); x++)
            if (LS.game.canThrowTo(sel, x, y))
              el('rect', { x: x * T + 2, y: y * T + 2, width: T - 4, height: T - 4, rx: 4, fill: C.throwRange }, layers.overlay);
      } else if (LS.state.reach) {
        const reach = LS.state.reach;
        const armedFill = sel.team === 'blue' ? C.reachBlue : C.reachRed;
        const snapCost = LS.game.fireAP(sel, 'snap'); // AP you must keep back to still get a reaction shot
        reach.cost.forEach((c, k) => {
          if (c === 0) return; // skip the unit's own tile
          const x = k % LS.config.cols, y = Math.floor(k / LS.config.cols);
          // full colour if you'd still have AP banked to react; grey if moving here spends you out
          const fill = (sel.ap - c) >= snapCost ? armedFill : C.reachSpent;
          const dangerous = danger.has(k); // red outline = a spotted enemy can shoot you here
          el('rect', {
            x: x * T + 2, y: y * T + 2, width: T - 4, height: T - 4, rx: 4, fill,
            stroke: dangerous ? C.target : 'none', 'stroke-width': dangerous ? 2 : 0,
          }, layers.overlay);
        });
        if (LS.game.canSnap(sel)) {
          LS.game.teamUnits(sel.team === 'blue' ? 'red' : 'blue').forEach(t => {
            if (LS.game.canFire(sel, t.x, t.y)) drawReticle(t.x, t.y, T, C);
          });
        }
      }
    }
    drawGrenades(T, C);
  }

  // attach a looping SMIL animation to an element (declarative pulse — no rAF loop to manage)
  function pulse(elem, attr, values, dur) {
    const a = document.createElementNS(SVGNS, 'animate');
    a.setAttribute('attributeName', attr);
    a.setAttribute('values', values);
    a.setAttribute('dur', dur);
    a.setAttribute('repeatCount', 'indefinite');
    elem.appendChild(a);
  }

  // live (cooked) grenades: the danger zone they'll hit + a pulsing marker with a lit fuse
  function drawGrenades(T, C) {
    LS.state.liveGrenades.forEach(g => {
      LS.game.blastTiles(g.x, g.y).forEach(({ x, y }) =>
        el('rect', { x: x * T + 1, y: y * T + 1, width: T - 2, height: T - 2, fill: C.blast }, layers.overlay));
      const cx = g.x * T + T / 2, cy = g.y * T + T / 2;
      // expanding "ping" ring
      const ring = el('circle', { cx, cy, r: T * 0.16, fill: 'none', stroke: C.fuse, 'stroke-width': 2 }, layers.overlay);
      pulse(ring, 'r', `${T * 0.16};${T * 0.42}`, '1s');
      pulse(ring, 'opacity', '0.85;0', '1s');
      // marker body
      el('circle', { cx, cy, r: T * 0.16, fill: C.grenadeBody, stroke: '#11140d', 'stroke-width': 1.5 }, layers.overlay);
      // blinking fuse
      const fuse = el('circle', { cx, cy: cy - T * 0.16, r: T * 0.055, fill: C.fuse }, layers.overlay);
      pulse(fuse, 'opacity', '1;0.25;1', '0.7s');
    });
  }

  function drawReticle(x, y, T, C) {
    const cx = x * T + T / 2, cy = y * T + T / 2, r = T * 0.46;
    el('circle', { cx, cy, r, fill: 'none', stroke: C.target, 'stroke-width': 2, 'stroke-dasharray': '4 4', opacity: 0.9 }, layers.overlay);
    const arm = T * 0.18;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      el('line', { x1: cx + dx * (r - arm), y1: cy + dy * (r - arm), x2: cx + dx * r, y2: cy + dy * r, stroke: C.target, 'stroke-width': 2 }, layers.overlay);
    });
  }

  // ---- soldier sprite: a chunky armoured "space marine", a distinct pose per facing ----
  const SPRITE = { d: '#262a32', m: '#525c68', hi: '#9aa4b0', visor: '#0c1726', glow: '#7fe3ff' };
  function teamPal(team) {
    // the player squad (the 'blue' team id) wears yellow marine armour; the AI 'red' squad stays red.
    // base/sh/dk/lt/spec = a 5-step ramp of one hue (craft rule 3); dk doubles as the silhouette outline.
    return team === 'blue'
      ? { base: '#f2c21e', sh: '#cf9512', dk: '#6e4a0c', lt: '#ffe79a', spec: '#fff6d8' }
      : { base: LS.config.colors.red, sh: '#c54141', dk: '#852a2a', lt: '#ffd2d2', spec: '#fff0f0' };
  }
  function mShadow(g, T) { el('ellipse', { cx: 0, cy: T * 0.40, rx: T * 0.30, ry: T * 0.085, fill: 'rgba(0,0,0,0.30)' }, g); }
  function mBoot(g, T, x) {
    el('rect', { x: x - T * 0.085, y: T * 0.24, width: T * 0.17, height: T * 0.16, rx: T * 0.045, fill: SPRITE.d }, g);
    el('rect', { x: x - T * 0.085, y: T * 0.24, width: T * 0.17, height: T * 0.05, rx: T * 0.04, fill: SPRITE.m, opacity: 0.8 }, g);
  }
  function mRivet(g, T, t, x, y) { el('circle', { cx: x, cy: y, r: T * 0.022, fill: t.dk, opacity: 0.55 }, g); }
  function mPauldron(g, T, t, x, y, r) {
    el('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.86, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
    el('path', { d: `M${x - r * 0.78} ${y - r * 0.12} a${r * 0.85} ${r * 0.7} 0 0 1 ${r * 1.56} 0 Z`, fill: t.lt, opacity: 0.55 }, g);  // top highlight (light from top of screen)
    el('path', { d: `M${x - r * 0.78} ${y + r * 0.22} a${r * 0.85} ${r * 0.7} 0 0 0 ${r * 1.56} 0 Z`, fill: '#000', opacity: 0.15 }, g); // underside AO
    mRivet(g, T, t, x, y + r * 0.28);
  }
  // rifle: drawn pointing +x, then rotated to the facing direction so it reads as aiming.
  // the two hands are drawn ON the gun (in its local space) so they ride with it, never drift.
  function mGun(g, T, t, ox, oy, L, rot) {
    const q = el('g', { transform: `translate(${ox},${oy}) rotate(${rot || 0})` }, g);
    el('rect', { x: -L * 0.40, y: -T * 0.05, width: L * 0.24, height: T * 0.13, rx: 2, fill: SPRITE.m }, q);            // stock
    el('rect', { x: -L * 0.20, y: -T * 0.075, width: L * 0.42, height: T * 0.16, rx: 3, fill: SPRITE.d }, q);           // body
    el('rect', { x: -L * 0.20, y: -T * 0.075, width: L * 0.42, height: T * 0.05, rx: 2, fill: SPRITE.m, opacity: 0.75 }, q);
    el('rect', { x: -L * 0.02, y: T * 0.05, width: L * 0.13, height: T * 0.20, rx: 2, fill: SPRITE.d, transform: `rotate(10 0 ${T * 0.05})` }, q); // magazine
    el('rect', { x: L * 0.22, y: -T * 0.026, width: L * 0.5, height: T * 0.062, rx: 2, fill: SPRITE.d }, q);            // barrel
    el('rect', { x: L * 0.64, y: -T * 0.04, width: L * 0.12, height: T * 0.09, rx: 2, fill: SPRITE.hi }, q);            // muzzle
    el('circle', { cx: -L * 0.06, cy: T * 0.03, r: T * 0.062, fill: t.sh, stroke: t.dk, 'stroke-width': 1.5 }, q);      // rear hand (trigger)
    el('circle', { cx: L * 0.16, cy: 0, r: T * 0.062, fill: t.sh, stroke: t.dk, 'stroke-width': 1.5 }, q);             // front hand (foregrip)
  }
  function mHelmet(g, T, t, x, y, r, back) {
    el('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.95, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
    el('path', { d: `M${x - r * 0.78} ${y - r * 0.2} a${r * 0.9} ${r * 0.85} 0 0 1 ${r * 1.56} 0 Z`, fill: t.lt, opacity: 0.6 }, g); // top highlight (always north)
    el('ellipse', { cx: x - r * 0.34, cy: y - r * 0.42, rx: r * 0.2, ry: r * 0.15, fill: t.spec, opacity: 0.6 }, g);     // offset shine (breaks symmetry)
    if (back) { el('circle', { cx: x, cy: y - r * 0.02, r: r * 0.32, fill: SPRITE.d }, g); el('circle', { cx: x - r * 0.1, cy: y - r * 0.12, r: r * 0.1, fill: SPRITE.m, opacity: 0.7 }, g); } // rear valve
  }
  // visor = a horizontal glowing eye-band on the FRONT of the helmet. It slides toward the
  // facing side and foreshortens for profile, but never rotates; the back shows no visor.
  function mVisorFront(g, T, t, x, y, r) {
    el('ellipse', { cx: x, cy: y + r * 0.16, rx: r * 0.66, ry: r * 0.38, fill: SPRITE.visor }, g);
    el('rect', { x: x - r * 0.4, y: y + r * 0.04, width: r * 0.8, height: r * 0.2, rx: r * 0.1, fill: SPRITE.glow, opacity: 0.9 }, g);
  }
  function mVisor3q(g, T, t, x, y, r, s) { // s = +1 front-right (SE)
    el('ellipse', { cx: x + s * r * 0.22, cy: y + r * 0.14, rx: r * 0.52, ry: r * 0.36, fill: SPRITE.visor }, g);
    el('rect', { x: x + s * r * 0.18 - r * 0.28, y: y + r * 0.04, width: r * 0.56, height: r * 0.18, rx: r * 0.09, fill: SPRITE.glow, opacity: 0.9 }, g);
  }
  function mVisorSide(g, T, t, x, y, r) { // facing right: same band, slid to the front (right) edge
    el('ellipse', { cx: x + r * 0.30, cy: y + r * 0.12, rx: r * 0.5, ry: r * 0.34, fill: SPRITE.visor }, g);
    el('rect', { x: x + r * 0.04, y: y + r * 0.02, width: r * 0.54, height: r * 0.18, rx: r * 0.09, fill: SPRITE.glow, opacity: 0.9 }, g);
  }
  function mChest(g, T, t, w, h, cy, back) {
    el('rect', { x: -w / 2, y: cy - h / 2, width: w, height: h, rx: T * 0.07, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
    el('rect', { x: -w / 2, y: cy + h * 0.04, width: w, height: h * 0.46, rx: T * 0.06, fill: '#000', opacity: 0.15 }, g);          // lower AO
    el('rect', { x: -w * 0.36, y: cy - h * 0.42, width: w * 0.72, height: h * 0.2, rx: T * 0.04, fill: t.lt, opacity: 0.45 }, g);   // top highlight
    if (!back) {
      el('line', { x1: 0, y1: cy - h * 0.28, x2: 0, y2: cy + h * 0.3, stroke: t.dk, 'stroke-width': 1.4, opacity: 0.5 }, g);        // centre seam (front only)
      mRivet(g, T, t, -w * 0.31, cy - h * 0.18); mRivet(g, T, t, w * 0.32, cy - h * 0.16); mRivet(g, T, t, -w * 0.29, cy + h * 0.24);
    }
  }
  function mBackpack(g, T) {
    el('rect', { x: -T * 0.15, y: -T * 0.13, width: T * 0.30, height: T * 0.28, rx: T * 0.05, fill: SPRITE.d }, g);
    el('rect', { x: -T * 0.15, y: -T * 0.13, width: T * 0.30, height: T * 0.08, rx: T * 0.05, fill: SPRITE.m, opacity: 0.55 }, g);
    el('rect', { x: -T * 0.10, y: -T * 0.005, width: T * 0.20, height: T * 0.08, rx: 2, fill: SPRITE.glow, opacity: 0.55 }, g);
  }
  const MARINE_POSES = {
    front(g, T, t) {
      mShadow(g, T); mBoot(g, T, -T * 0.13); mBoot(g, T, T * 0.13);
      mChest(g, T, t, T * 0.42, T * 0.34, T * 0.03);
      mPauldron(g, T, t, -T * 0.25, -T * 0.12, T * 0.135); mPauldron(g, T, t, T * 0.25, -T * 0.11, T * 0.125);
      mGun(g, T, t, -T * 0.04, T * 0.10, T * 0.50, 38);
      mHelmet(g, T, t, 0, -T * 0.28, T * 0.195, false); mVisorFront(g, T, t, 0, -T * 0.28, T * 0.195);
    },
    threeqFront(g, T, t) {
      mShadow(g, T); mBoot(g, T, -T * 0.13); mBoot(g, T, T * 0.11);
      mPauldron(g, T, t, -T * 0.21, -T * 0.12, T * 0.115);   // far shoulder
      mChest(g, T, t, T * 0.38, T * 0.34, T * 0.03);
      mGun(g, T, t, 0, T * 0.08, T * 0.50, 45);              // aims down-right
      mPauldron(g, T, t, T * 0.23, -T * 0.11, T * 0.14);     // near shoulder
      mHelmet(g, T, t, T * 0.04, -T * 0.28, T * 0.195, false); mVisor3q(g, T, t, T * 0.04, -T * 0.28, T * 0.195, 1);
    },
    side(g, T, t) {
      mShadow(g, T); mBoot(g, T, -T * 0.02); mBoot(g, T, T * 0.06);
      mPauldron(g, T, t, -T * 0.13, -T * 0.11, T * 0.10);    // far
      mChest(g, T, t, T * 0.30, T * 0.34, T * 0.02);
      mGun(g, T, t, T * 0.06, -T * 0.005, T * 0.56, 0);      // points forward (right)
      mPauldron(g, T, t, T * 0.07, -T * 0.11, T * 0.14);     // near
      mHelmet(g, T, t, T * 0.05, -T * 0.28, T * 0.195, false); mVisorSide(g, T, t, T * 0.05, -T * 0.28, T * 0.195);
    },
    backThreeq(g, T, t) {
      mShadow(g, T); mBoot(g, T, -T * 0.10); mBoot(g, T, T * 0.13);
      mPauldron(g, T, t, -T * 0.21, -T * 0.12, T * 0.115);
      mChest(g, T, t, T * 0.38, T * 0.34, T * 0.03, true); mBackpack(g, T);
      el('rect', { x: T * 0.1, y: -T * 0.06, width: T * 0.34, height: T * 0.055, rx: 2, fill: SPRITE.d, transform: `rotate(-38 ${T * 0.1} ${-T * 0.04})` }, g);   // barrel over shoulder
      el('rect', { x: T * 0.4, y: -T * 0.075, width: T * 0.07, height: T * 0.05, rx: 2, fill: SPRITE.hi, transform: `rotate(-38 ${T * 0.1} ${-T * 0.04})` }, g);  // muzzle tip
      mPauldron(g, T, t, T * 0.23, -T * 0.11, T * 0.14);
      mHelmet(g, T, t, T * 0.04, -T * 0.28, T * 0.195, true);
    },
    back(g, T, t) {
      mShadow(g, T); mBoot(g, T, -T * 0.13); mBoot(g, T, T * 0.13);
      mPauldron(g, T, t, -T * 0.25, -T * 0.12, T * 0.13); mPauldron(g, T, t, T * 0.25, -T * 0.12, T * 0.13);
      mChest(g, T, t, T * 0.42, T * 0.34, T * 0.03, true); mBackpack(g, T);
      el('rect', { x: -T * 0.03, y: -T * 0.34, width: T * 0.05, height: T * 0.12, rx: 2, fill: SPRITE.d }, g);   // antenna
      mHelmet(g, T, t, 0, -T * 0.28, T * 0.195, true);
    },
  };
  // facing index (0=N clockwise) -> [pose, mirror-horizontally]
  const FACING_POSE = [
    ['back', false], ['backThreeq', false], ['side', false], ['threeqFront', false],
    ['front', false], ['threeqFront', true], ['side', true], ['backThreeq', true],
  ];
  // gentle always-on "breathing" bob (SMIL), phase-offset per soldier so they don't bob in unison
  function idleBob(g, id) {
    if (!LS.config.anim.enabled) return;
    const phase = ([...(id || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 24) / 10;
    const a = document.createElementNS(SVGNS, 'animateTransform');
    a.setAttribute('attributeName', 'transform'); a.setAttribute('type', 'translate');
    a.setAttribute('values', '0 0; 0 -1.4; 0 0'); a.setAttribute('dur', '2.4s');
    a.setAttribute('repeatCount', 'indefinite'); a.setAttribute('begin', `-${phase}s`);
    a.setAttribute('calcMode', 'spline'); a.setAttribute('keyTimes', '0;0.5;1');
    a.setAttribute('keySplines', '0.45 0 0.55 1;0.45 0 0.55 1');
    g.appendChild(a);
  }
  // weapon recoil: kick the figure backward (opposite its facing), then ease home
  function recoil(ag, fdx, fdy) {
    if (!ag) return;
    const L = Math.hypot(fdx, fdy) || 1, bx = -fdx / L * 4.5, by = -fdy / L * 4.5;
    const out = 90, back = 220; let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts; const e = ts - start; let k;
      if (e < out) k = e / out; else if (e < out + back) k = 1 - (e - out) / back; else { ag.removeAttribute('transform'); return; }
      ag.setAttribute('transform', `translate(${bx * k},${by * k})`);
      requestAnimationFrame(f);
    });
  }
  // throw: a small wind-up back, then a lunge toward the target
  function throwLunge(ag, dx, dy) {
    if (!ag) return;
    const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
    const wind = 190, fwd = 230, wb = 3.5, fw = 5; let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts; const e = ts - start; let d;
      if (e < wind) d = -wb * (e / wind);
      else if (e < wind + fwd) d = -wb + (wb + fw) * ((e - wind) / fwd);
      else { ag.removeAttribute('transform'); return; }
      ag.setAttribute('transform', `translate(${ux * d},${uy * d})`);
      requestAnimationFrame(f);
    });
  }
  function drawMarine(parent, T, facing, team, id) {
    const [pose, mirror] = FACING_POSE[facing] || ['front', false];
    const animG = el('g', {}, parent);            // idle breathing (SMIL)
    idleBob(animG, id);
    const actionG = el('g', {}, animG);           // walk / recoil / throw (JS)
    const mir = el('g', mirror ? { transform: 'scale(-1,1)' } : {}, actionG);
    MARINE_POSES[pose](mir, T, teamPal(team));
    return actionG;
  }

  // paint one soldier (selection ring + sprite + health bar) into its group; returns its action group
  function paintUnit(g, u, T, C) {
    if (LS.state.selectedId === u.id) {
      el('circle', { cx: 0, cy: 0, r: T * 0.47, fill: 'none', stroke: C.select, 'stroke-width': 2.5, 'stroke-dasharray': '5 4' }, g);
    }
    const action = drawMarine(g, T, u.facing, u.team, u.id);
    const bw = T * 0.5, bh = 4, bx = -bw / 2, by = -T * 0.56;
    el('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, fill: 'rgba(0,0,0,0.55)' }, g);
    el('rect', { x: bx, y: by, width: bw * (u.hp / u.maxHp), height: bh, rx: 2, fill: u.hp / u.maxHp > 0.4 ? '#6bd86b' : '#e0b13a' }, g);
    return action;
  }
  // re-draw a single soldier in place (used to turn it to a new facing mid-move, without moving it)
  function refaceUnit(u) {
    const ue = unitEls[u.id]; if (!ue) return;
    while (ue.g.firstChild) ue.g.removeChild(ue.g.firstChild);
    ue.action = paintUnit(ue.g, u, LS.config.tile, LS.config.colors);
  }

  const revealed = new Set(); // unit ids forced visible regardless of fog (e.g. an AI unit firing)
  function reveal(id) { revealed.add(id); }
  function unreveal(id) { revealed.delete(id); }

  // --- debug "watch AI" mode: lift the fog for the whole enemy turn and caption each decision ---
  let watchAll = false;                 // when true, draw() shows every unit and skips the fog veil
  function setWatchAll(b) { watchAll = b; if (!b) clearAiLabel(); }
  function isWatching() { return watchAll; }
  let aiLabel = null;                   // { unitId, text, color, el } — a caption that follows the acting unit
  function clearAiLabel() { if (aiLabel && aiLabel.el) aiLabel.el.remove(); aiLabel = null; }
  function setAiLabel(unit, text, color) {
    clearAiLabel();
    if (!unit || !text) return;
    aiLabel = { unitId: unit.id, text, color: color || '#e6ad33' };
    renderAiLabel();
  }
  function renderAiLabel() {             // (re)draw the caption above its unit; called each draw() so it tracks moves
    if (!aiLabel) return;
    if (aiLabel.el) { aiLabel.el.remove(); aiLabel.el = null; }
    const u = LS.game.unitById(aiLabel.unitId);
    if (!u || !u.alive) return;
    const T = LS.config.tile, cx = u.x * T + T / 2, cy = u.y * T + T / 2;
    const w = Math.max(T * 0.8, aiLabel.text.length * 6.6 + 14);
    const g = el('g', { transform: `translate(${cx},${cy - T * 0.66})` }, layers.fx);
    el('rect', { x: -w / 2, y: -10, width: w, height: 18, rx: 3, fill: 'rgba(8,10,6,0.88)', stroke: aiLabel.color, 'stroke-width': 1 }, g);
    const t = el('text', { x: 0, y: 3.5, fill: aiLabel.color, 'font-size': 11, 'font-family': 'monospace', 'font-weight': 700, 'text-anchor': 'middle' }, g);
    t.textContent = aiLabel.text;
    aiLabel.el = g;
  }

  function drawUnits(T, C) {
    clear(layers.units);
    for (const id in unitEls) delete unitEls[id];
    const viewer = LS.game.viewTeam();
    LS.state.units.filter(u => u.alive).forEach(u => {
      if (!watchAll && u.team !== viewer && !vision.has(LS.game.key(u.x, u.y)) && !revealed.has(u.id)) return; // hidden by fog
      const g = el('g', { transform: `translate(${u.x * T + T / 2},${u.y * T + T / 2})` }, layers.units);
      unitEls[u.id] = { g, action: paintUnit(g, u, T, C) };
    });
    drawGhosts(T, C, viewer);
  }

  // faded "?" markers where the active team last saw an enemy that's now out of sight
  function drawGhosts(T, C, active) {
    const know = LS.state.knowledge[active];
    const enemyColor = active === 'blue' ? C.red : C.blue;
    for (const id in know) {
      const e = LS.game.unitById(id);
      if (e && e.alive && vision.has(LS.game.key(e.x, e.y))) continue; // currently visible -> drawn for real
      const gh = know[id];
      const op = Math.max(0.16, 0.5 - (LS.state.turnCount - gh.turn) * 0.12);
      const cx = gh.x * T + T / 2, cy = gh.y * T + T / 2;
      const g = el('g', { transform: `translate(${cx},${cy})`, opacity: op }, layers.units);
      el('circle', { cx: 0, cy: 0, r: T * 0.30, fill: 'none', stroke: enemyColor, 'stroke-width': 2, 'stroke-dasharray': '3 4' }, g);
      const t = el('text', { x: 0, y: T * 0.13, fill: enemyColor, 'font-size': T * 0.34, 'font-weight': 800, 'text-anchor': 'middle', 'font-family': 'monospace' }, g);
      t.textContent = '?';
    }
  }

  // tint every tile the soldier can actually watch (real arc + walls) — the antidote to opaque reactions
  function drawThreat(u, T) {
    const fill = u.team !== LS.game.viewTeam() ? LS.config.colors.threatEnemy : LS.config.colors.threatAlly;
    for (let y = 0; y < LS.config.rows; y++)
      for (let x = 0; x < LS.config.cols; x++)
        if (!(x === u.x && y === u.y) && LS.los.canSee(u, x, y))
          el('rect', { x: x * T, y: y * T, width: T, height: T, fill }, layers.threat);
  }

  // hover feedback: threat zone of the soldier under the cursor, plus path/AP or a hit-chance readout
  function drawHover(tx, ty) {
    clear(layers.hover);
    clear(layers.threat);
    if (LS.state.busy || LS.state.over || LS.state.handoff || tx == null) return;
    const T = LS.config.tile, C = LS.config.colors;

    // grenade aiming: show the blast footprint under the cursor
    if (LS.state.throwMode) {
      const u = LS.game.selected();
      if (u && LS.game.canThrowTo(u, tx, ty)) {
        LS.game.blastTiles(tx, ty).forEach(({ x, y }) => el('rect', { x: x * T + 1, y: y * T + 1, width: T - 2, height: T - 2, fill: C.blast }, layers.hover));
        label('throw', tx * T + T / 2, ty * T - 6, '#ffae3c', T);
      }
      return;
    }

    const hov = LS.game.unitAt(tx, ty);
    // a fogged enemy must not leak through the hover readouts
    const hovVisible = hov && (hov.team === LS.game.viewTeam() || vision.has(LS.game.key(tx, ty)));
    if (hovVisible) drawThreat(hov, T);

    const sel = LS.game.selected();
    if (!sel) return;

    // door / window action hints. A closed door shows 'open'; an open door falls through to the
    // step-in cost (you walk into it), and closing is the ✕ badge, handled separately.
    if (LS.los.isDoor(tx, ty) && !LS.los.doorOpen(tx, ty) && Math.abs(sel.x - tx) + Math.abs(sel.y - ty) === 1 && sel.ap >= LS.config.ap.door) {
      label('open', tx * T + T / 2, ty * T - 6, C.select, T); return;
    }
    if (LS.los.isWindow(tx, ty) && !LS.los.windowSmashed(tx, ty)) {
      const adj = Math.abs(sel.x - tx) + Math.abs(sel.y - ty) === 1;
      if (adj && sel.ap >= LS.config.ap.door) { label('smash', tx * T + T / 2, ty * T - 6, C.select, T); return; }
      if (!adj && LS.game.canFire(sel, tx, ty) && sel.ap >= LS.game.fireAP(sel, 'snap')) { label('shoot glass', tx * T + T / 2, ty * T - 6, C.target, T); return; }
    }

    // hit-chance readout over a targetable enemy — for the currently-selected fire mode (reflects cover)
    if (hovVisible && hov.team !== sel.team && LS.game.canFire(sel, tx, ty) && sel.ap >= LS.game.fireAP(sel, LS.state.fireMode)) {
      const mode = LS.state.fireMode;
      const ch = LS.game.hitChance(sel, tx, ty, mode);
      const cover = LS.game.inCoverFrom(tx, ty, sel.x, sel.y);
      label(`${mode === 'snap' ? 'snap' : 'aimed'} ${Math.round(ch * 100)}%${cover ? ' · cover' : ''}`, tx * T + T / 2, ty * T - 6, C.target, T);
      return;
    }
    // path preview to a reachable empty tile
    const reach = LS.state.reach, k = LS.game.key(tx, ty);
    if (!hov && reach && reach.cost.has(k) && reach.cost.get(k) > 0) {
      const path = LS.game.pathTo(reach, tx, ty);
      if (path) {
        path.forEach((p, i) => { if (i) el('circle', { cx: p.x * T + T / 2, cy: p.y * T + T / 2, r: 3.5, fill: C.path, opacity: 0.85 }, layers.hover); });
        label(`${reach.cost.get(k)} AP`, tx * T + T / 2, ty * T - 6, C.path, T);
      }
    }
  }

  function label(text, cx, y, color, T) {
    const w = text.length * 8 + 10;
    el('rect', { x: cx - w / 2, y: y - 14, width: w, height: 17, rx: 3, fill: 'rgba(0,0,0,0.7)' }, layers.hover);
    const t = el('text', { x: cx, y: y - 1, fill: color, 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle', 'font-family': 'monospace' }, layers.hover);
    t.textContent = text;
  }

  // glide a unit across one tile, then call done() — lets the move pause for reaction checks between tiles
  // ease the camera toward keeping a (moving) world point inside a comfortable centre box. Called
  // every animation frame so a long walk scrolls smoothly instead of snapping tile-by-tile.
  function softFollow(wx, wy) {
    const T = LS.config.tile, V = LS.config.view, cam = LS.state.cam, m = 4 * T;
    let tx = cam.x, ty = cam.y;
    if (wx < cam.x + m) tx = wx - m; else if (wx > cam.x + V.cols * T - m) tx = wx - V.cols * T + m;
    if (wy < cam.y + m) ty = wy - m; else if (wy > cam.y + V.rows * T - m) ty = wy - V.rows * T + m;
    if (tx === cam.x && ty === cam.y) return;            // comfortably in view — hold still
    setCamera(cam.x + (tx - cam.x) * 0.2, cam.y + (ty - cam.y) * 0.2); // ease ~20% of the gap per frame
  }

  function animateStep(unit, from, to, done) {
    const ue = unitEls[unit.id], g = ue && ue.g, action = ue && ue.action, T = LS.config.tile;
    const x1 = to.x * T + T / 2, y1 = to.y * T + T / 2;
    if (!g || !LS.config.anim.enabled) { if (g) g.setAttribute('transform', `translate(${x1},${y1})`); followUnit(unit); done(); return; }
    const x0 = from.x * T + T / 2, y0 = from.y * T + T / 2, dur = LS.config.anim.msPerTile;
    LS.sound.play('step'); // one footfall per tile of the walk
    let start = null;
    function f(ts) {
      if (start === null) start = ts;
      let p = (ts - start) / dur; if (p > 1) p = 1;
      const ux = x0 + (x1 - x0) * p, uy = y0 + (y1 - y0) * p;
      g.setAttribute('transform', `translate(${ux},${uy})`);
      if (action) action.setAttribute('transform', `translate(0,${-Math.abs(Math.sin(p * Math.PI * 3)) * 2.5})`); // walk bob
      softFollow(ux, uy); // glide the camera with the unit (no per-tile snap)
      if (p < 1) requestAnimationFrame(f); else { if (action) action.removeAttribute('transform'); done(); }
    }
    requestAnimationFrame(f);
  }

  // --- shot feedback: muzzle flash, travelling bolt, impact, floating damage/miss ---
  function shotFx(shooter, target, result, done) {
    const shot = (LS.game.weaponOf(shooter) || {}).shot || { sound: 'fire', color: '#ffe08a', width: 3, dur: 190 };
    LS.sound.play(result.glass ? 'fire' : shot.sound);
    if (!LS.config.anim.enabled) { done && done(); return; }
    const sa = unitEls[shooter.id] && unitEls[shooter.id].action;
    if (sa) { const f = LS.DIRS[shooter.facing]; recoil(sa, f.dx, f.dy); }
    const T = LS.config.tile, C = LS.config.colors;
    const sx = shooter.x * T + T / 2, sy = shooter.y * T + T / 2;
    const tcx = target.x * T + T / 2, tcy = target.y * T + T / 2;

    // a miss sails wide of the target — and stops dead if it meets a wall or window on the way
    let ex = tcx, ey = tcy, missHit = null;
    if (!result.hit) {
      const ang = Math.atan2(tcy - sy, tcx - sx) + ((target.x + target.y) % 2 ? 0.17 : -0.17);
      const maxD = Math.hypot(tcx - sx, tcy - sy) + T * 1.5;
      missHit = raycastToWall(sx, sy, ang, maxD);
      ex = missHit.x; ey = missHit.y;
    }

    fade(el('circle', { cx: sx, cy: sy, r: T * (shot.glow ? 0.22 : 0.16), fill: shot.color, opacity: 0.92 }, layers.fx), 180);

    // a heavy bolt gets a faint wider glow behind the core line
    const glow = shot.glow ? el('line', { x1: sx, y1: sy, x2: sx, y2: sy, stroke: shot.color, 'stroke-width': shot.width * 2.6, 'stroke-linecap': 'round', opacity: 0.3 }, layers.fx) : null;
    const bolt = el('line', { x1: sx, y1: sy, x2: sx, y2: sy, stroke: shot.color, 'stroke-width': shot.width, 'stroke-linecap': 'round' }, layers.fx);
    const dur = shot.dur || 190; let start = null;
    function fly(ts) {
      if (start === null) start = ts;
      let p = (ts - start) / dur; if (p > 1) p = 1;
      const tailP = Math.max(0, p - 0.25);
      const x1 = sx + (ex - sx) * tailP, y1 = sy + (ey - sy) * tailP, x2 = sx + (ex - sx) * p, y2 = sy + (ey - sy) * p;
      bolt.setAttribute('x1', x1); bolt.setAttribute('y1', y1); bolt.setAttribute('x2', x2); bolt.setAttribute('y2', y2);
      if (glow) { glow.setAttribute('x1', x1); glow.setAttribute('y1', y1); glow.setAttribute('x2', x2); glow.setAttribute('y2', y2); }
      if (p < 1) requestAnimationFrame(fly); else { bolt.remove(); if (glow) glow.remove(); impact(); }
    }
    requestAnimationFrame(fly);

    function impact() {
      if (result.glass) { LS.sound.play('glass'); glassBurst(tcx, tcy); setTimeout(() => done && done(), 160); return; }
      if (result.hit) {
        LS.sound.play(result.killed ? 'down' : 'hit');
        LS.sound.play(result.killed ? 'death' : 'hurt'); // the soldier's yelp / death cry
        expand(el('circle', { cx: tcx, cy: tcy, r: T * 0.1, fill: 'none', stroke: C.target, 'stroke-width': 3 }, layers.fx), T * 0.5, 280);
        floatText(`-${result.dmg}`, tcx, tcy - T * 0.2, C.target);
        if (result.killed) floatText('DOWN', tcx, tcy - T * 0.5, C.select, 1000);
      } else {
        LS.sound.play('miss');
        if (missHit && missHit.hit === 'window') {
          LS.game.breakWindow(missHit.tx, missHit.ty); // a stray round shatters the glass it strikes
          LS.sound.play('glass');
          glassBurst(ex, ey);
        } else if (missHit && missHit.hit === 'wall') {
          expand(el('circle', { cx: ex, cy: ey, r: T * 0.06, fill: 'none', stroke: '#9aa3af', 'stroke-width': 2.5 }, layers.fx), T * 0.28, 220);
        }
        floatText('miss', ex, ey, '#9aa3af', 600);
      }
      setTimeout(() => done && done(), result.hit ? 200 : 120);
    }
  }

  // march a ray from (sx,sy) along ang until it meets anything that stops a shot, or the map edge
  function raycastToWall(sx, sy, ang, maxD) {
    const T = LS.config.tile, step = T * 0.2;
    const cx = Math.cos(ang), cy = Math.sin(ang);
    for (let d = step; d <= maxD; d += step) {
      const px = sx + cx * d, py = sy + cy * d;
      const tx = Math.floor(px / T), ty = Math.floor(py / T);
      if (tx < 0 || ty < 0 || tx >= LS.config.cols || ty >= LS.config.rows)
        return { x: sx + cx * (d - step), y: sy + cy * (d - step), hit: 'edge' };
      if (LS.los.blocksShot(tx, ty)) return { x: px, y: py, hit: LS.los.isWindow(tx, ty) ? 'window' : 'wall', tx, ty };
    }
    return { x: sx + cx * maxD, y: sy + cy * maxD, hit: 'none' };
  }

  function fade(elem, ms) {
    let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / ms);
      elem.setAttribute('opacity', String(1 - p));
      if (p < 1) requestAnimationFrame(f); else elem.remove();
    });
  }

  function expand(circle, toR, ms) {
    const fromR = parseFloat(circle.getAttribute('r')); let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / ms);
      circle.setAttribute('r', fromR + (toR - fromR) * p);
      circle.setAttribute('opacity', String(0.9 * (1 - p)));
      if (p < 1) requestAnimationFrame(f); else circle.remove();
    });
  }

  function floatText(text, x, y, color, ms = 850) {
    const t = el('text', {
      x, y, fill: color, 'font-size': 15, 'font-weight': 800, 'text-anchor': 'middle',
      'font-family': 'ui-monospace, monospace', stroke: 'rgba(0,0,0,0.6)', 'stroke-width': 3, 'paint-order': 'stroke',
    }, layers.fx);
    t.textContent = text;
    let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / ms);
      t.setAttribute('y', y - 24 * p);
      t.setAttribute('opacity', String(1 - p));
      if (p < 1) requestAnimationFrame(f); else t.remove();
    });
  }

  // a burst of glass shards (used by a shot that shatters a window, and by a melee smash)
  function glassBurst(cx, cy) {
    const T = LS.config.tile, C = LS.config.colors;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      fade(el('line', {
        x1: cx + Math.cos(a) * T * 0.1, y1: cy + Math.sin(a) * T * 0.1,
        x2: cx + Math.cos(a) * T * 0.34, y2: cy + Math.sin(a) * T * 0.34,
        stroke: C.glassEdge, 'stroke-width': 2, 'stroke-linecap': 'round',
      }, layers.fx), 320);
    }
  }

  // public: a window smashed at melee range (no bolt, just the shatter)
  function glassFx(x, y) {
    const T = LS.config.tile;
    LS.sound.play('glass');
    glassBurst(x * T + T / 2, y * T + T / 2);
  }

  // lob a grenade along a parabola from `from` to `to`, then done()
  function throwArc(from, to, done) {
    const T = LS.config.tile, C = LS.config.colors;
    LS.sound.play('throw');
    if (!LS.config.anim.enabled) { done && done(); return; }
    const ta = unitEls[from.id] && unitEls[from.id].action;
    if (ta) throwLunge(ta, to.x - from.x, to.y - from.y);
    const x0 = from.x * T + T / 2, y0 = from.y * T + T / 2;
    const x2 = to.x * T + T / 2, y2 = to.y * T + T / 2;
    const arcH = Math.min(T * 2.2, Math.hypot(x2 - x0, y2 - y0) * 0.5 + T * 0.6);
    const cxp = (x0 + x2) / 2, cyp = (y0 + y2) / 2 - arcH; // control point lifts the path
    const gr = el('circle', { r: T * 0.15, fill: C.grenadeBody, stroke: '#11140d', 'stroke-width': 1.5 }, layers.fx);
    let start = null;
    requestAnimationFrame(function f(ts) {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / 420), mt = 1 - t;
      gr.setAttribute('cx', mt * mt * x0 + 2 * mt * t * cxp + t * t * x2);
      gr.setAttribute('cy', mt * mt * y0 + 2 * mt * t * cyp + t * t * y2);
      if (t < 1) requestAnimationFrame(f); else { gr.remove(); done && done(); }
    });
  }

  // an explosion at grenade g with its damage hits (floating numbers per victim)
  function explosionFx(g, hits, done) {
    LS.sound.play('boom');
    const T = LS.config.tile;
    if (!LS.config.anim.enabled) { done && done(); return; }
    const cx = g.x * T + T / 2, cy = g.y * T + T / 2, RR = LS.config.grenade.radius;
    fade(el('circle', { cx, cy, r: T * 0.5, fill: '#ffd27a', opacity: 0.9 }, layers.fx), 220);
    expand(el('circle', { cx, cy, r: T * 0.2, fill: 'none', stroke: '#ff7a2a', 'stroke-width': 4 }, layers.fx), T * (RR + 0.6), 380);
    expand(el('circle', { cx, cy, r: T * 0.15, fill: 'none', stroke: '#ffd27a', 'stroke-width': 2 }, layers.fx), T * (RR + 0.2), 320);
    hits.forEach(h => {
      floatText(`-${h.dmg}`, h.x * T + T / 2, h.y * T + T / 2 - T * 0.2, LS.config.colors.target);
      if (h.killed) floatText('DOWN', h.x * T + T / 2, h.y * T + T / 2 - T * 0.5, LS.config.colors.select, 1000);
    });
    setTimeout(() => done && done(), 320);
  }

  return { init, draw, drawHover, drawFacing, animateStep, refaceUnit, shotFx, glassFx, throwArc, explosionFx, setCamera, centerOn, panBy, followUnit, contactMoment, focusTile, reveal, unreveal, setWatchAll, isWatching, setAiLabel, clearAiLabel, flushAlertCallout, unitEls };
})();
