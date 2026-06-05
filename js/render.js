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
    ['terrain', 'fog', 'overlay', 'threat', 'units', 'facing', 'hover', 'fx'].forEach(name => {
      layers[name] = el('g', { id: 'layer-' + name }, svg);
    });
    setCamera(LS.state.cam.x, LS.state.cam.y); // the viewBox is a window onto the (possibly larger) map
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
  // recentre on a unit only if it's near/past the visible edge (keeps the action on screen without jitter)
  function followUnit(u) {
    const T = LS.config.tile, V = LS.config.view, cam = LS.state.cam;
    const wx = u.x * T + T / 2, wy = u.y * T + T / 2, m = 2.5 * T;
    if (wx < cam.x + m || wx > cam.x + V.cols * T - m || wy < cam.y + m || wy > cam.y + V.rows * T - m) centerOn(wx, wy);
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

  function draw() {
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
    LS.ui.update();
  }

  // veil every tile the active squad can't currently see
  function drawFog(T, C) {
    clear(layers.fog);
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
        const decor = !rubbled && !cratered && LS.los.isDecor(x, y); // crate/desk/locker/console
        const floorLike = ch === '_' || ch === 'D' || ch === 'R' || decor; // decor sits on a floor
        let fill;
        if (rubbled) fill = (x + y) % 2 ? C.floorB : C.floorA;     // blown open -> floor
        else if (ch === '#') fill = C.wall;
        else if (ch === 'x') fill = C.wallWeak;
        else if (ch === 'W') fill = C.wall;                        // a window sits in a wall
        else if (floorLike) fill = (x + y) % 2 ? C.floorB : C.floorA;
        else fill = (x + y) % 2 ? C.groundB : C.groundA;           // '.' ground
        el('rect', { x: x * T, y: y * T, width: T, height: T, fill }, layers.terrain);
        if ((ch === '_' || decor) && !rubbled && !cratered) // subtle floor panel seam (muted, so overlays stay clean)
          el('rect', { x: x * T + 3, y: y * T + 3, width: T - 6, height: T - 6, rx: 3, fill: 'none', stroke: 'rgba(0,0,0,0.16)', 'stroke-width': 1 }, layers.terrain);

        if (rubbled) drawRubble(x, y, T, C);
        else if (cratered) drawCrater(x, y, T, C);
        else if (ch === '#') drawWall(x, y, T, C);
        else if (ch === 'x') drawBreakableWall(x, y, T, C);
        else if (ch === 'D' || ch === 'R') drawDoor(x, y, T, C, ch === 'R');
        else if (ch === 'W') drawWindow(x, y, T, C);
        else if (decor) drawDecor(x, y, T, C, ch);

        el('rect', { x: x * T, y: y * T, width: T, height: T, fill: 'none', stroke: C.grid, 'stroke-width': 1 }, layers.terrain);
      }
    }
  }

  // reinforced wall: top light bevel, bottom shade, panel seams + rivets (depth, but muted)
  function drawWall(x, y, T, C) {
    const cx = x * T, cy = y * T;
    el('rect', { x: cx, y: cy, width: T, height: T * 0.24, fill: C.wallTop }, layers.terrain);
    el('rect', { x: cx, y: cy + T * 0.82, width: T, height: T * 0.18, fill: 'rgba(0,0,0,0.22)' }, layers.terrain);
    el('line', { x1: cx + T * 0.5, y1: cy + T * 0.24, x2: cx + T * 0.5, y2: cy + T, stroke: 'rgba(0,0,0,0.28)', 'stroke-width': 1 }, layers.terrain);
    el('line', { x1: cx, y1: cy + T * 0.6, x2: cx + T, y2: cy + T * 0.6, stroke: 'rgba(255,255,255,0.045)', 'stroke-width': 1 }, layers.terrain);
    el('circle', { cx: cx + T * 0.17, cy: cy + T * 0.42, r: T * 0.03, fill: C.wallTop }, layers.terrain);
    el('circle', { cx: cx + T * 0.83, cy: cy + T * 0.42, r: T * 0.03, fill: C.wallTop }, layers.terrain);
  }

  function drawBreakableWall(x, y, T, C) {
    const cx = x * T, cy = y * T;
    el('rect', { x: cx, y: cy, width: T, height: T * 0.22, fill: C.wallTop }, layers.terrain);
    el('rect', { x: cx, y: cy + T * 0.84, width: T, height: T * 0.16, fill: 'rgba(0,0,0,0.18)' }, layers.terrain);
    el('polyline', { points: `${cx + T * 0.3},${cy} ${cx + T * 0.44},${cy + T * 0.4} ${cx + T * 0.34},${cy + T * 0.72} ${cx + T * 0.46},${cy + T}`, fill: 'none', stroke: C.crack, 'stroke-width': 1.5 }, layers.terrain);
    el('polyline', { points: `${cx + T * 0.72},${cy + T * 0.12} ${cx + T * 0.6},${cy + T * 0.5} ${cx + T * 0.74},${cy + T * 0.85}`, fill: 'none', stroke: C.crack, 'stroke-width': 1.2 }, layers.terrain);
    // a wall that's taken a blast but held looks scorched and more cracked (HP itself stays hidden)
    const w = LS.state.wallHp && LS.state.wallHp.get(LS.game.key(x, y));
    if (w && w.hp < w.max) {
      el('rect', { x: cx, y: cy, width: T, height: T, fill: 'rgba(0,0,0,0.22)' }, layers.terrain);
      el('polyline', { points: `${cx + T * 0.15},${cy + T * 0.3} ${cx + T * 0.5},${cy + T * 0.55} ${cx + T * 0.85},${cy + T * 0.4}`, fill: 'none', stroke: C.crack, 'stroke-width': 1.6 }, layers.terrain);
    }
  }

  function drawRubble(x, y, T, C) {
    const cx = x * T, cy = y * T;
    [[0.22, 0.28], [0.56, 0.4], [0.38, 0.66], [0.72, 0.7], [0.3, 0.52]].forEach(([fx, fy], i) => {
      const s = T * (0.1 + (i % 3) * 0.03);
      el('rect', { x: cx + T * fx, y: cy + T * fy, width: s, height: s, rx: 1.5, fill: C.rubble, opacity: 0.8 }, layers.terrain);
    });
  }

  function drawCrater(x, y, T, C) {
    const cx = x * T + T / 2, cy = y * T + T / 2;
    el('circle', { cx, cy, r: T * 0.46, fill: 'none', stroke: 'rgba(70,48,22,0.5)', 'stroke-width': 3 }, layers.terrain); // scorched rim
    el('circle', { cx, cy, r: T * 0.42, fill: C.crater, stroke: C.craterEdge, 'stroke-width': 2 }, layers.terrain);
    el('circle', { cx, cy, r: T * 0.24, fill: '#000', opacity: 0.5 }, layers.terrain);
  }

  // doors/windows orient along the wall they sit in (barriers above & below => vertical wall run)
  function drawDoor(x, y, T, C, reinforced) {
    const open = LS.los.doorOpen(x, y);
    const vertical = LS.los.isBarrier(x, y - 1) && LS.los.isBarrier(x, y + 1);
    const leaf = reinforced ? C.doorSteel : C.doorLeaf;
    const frame = reinforced ? C.doorSteelFrame : C.doorFrame;
    const cx = x * T, cy = y * T;
    if (open) {
      if (vertical) {
        el('rect', { x: cx + T * 0.40, y: cy, width: T * 0.20, height: T * 0.12, fill: frame }, layers.terrain);
        el('rect', { x: cx + T * 0.40, y: cy + T * 0.88, width: T * 0.20, height: T * 0.12, fill: frame }, layers.terrain);
        el('rect', { x: cx + T * 0.52, y: cy + T * 0.07, width: T * 0.40, height: T * 0.12, rx: 2, fill: leaf, stroke: frame, 'stroke-width': 1 }, layers.terrain);
      } else {
        el('rect', { x: cx, y: cy + T * 0.40, width: T * 0.12, height: T * 0.20, fill: frame }, layers.terrain);
        el('rect', { x: cx + T * 0.88, y: cy + T * 0.40, width: T * 0.12, height: T * 0.20, fill: frame }, layers.terrain);
        el('rect', { x: cx + T * 0.07, y: cy + T * 0.52, width: T * 0.12, height: T * 0.40, rx: 2, fill: leaf, stroke: frame, 'stroke-width': 1 }, layers.terrain);
      }
    } else {
      const lx = vertical ? cx + T * 0.32 : cx + T * 0.05;
      const ly = vertical ? cy + T * 0.05 : cy + T * 0.32;
      const lw = vertical ? T * 0.36 : T * 0.90;
      const lh = vertical ? T * 0.90 : T * 0.36;
      el('rect', { x: lx, y: ly, width: lw, height: lh, rx: 3, fill: leaf, stroke: frame, 'stroke-width': 2 }, layers.terrain);
      if (reinforced) {
        // rivets to read as a blast-proof bulkhead
        [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]].forEach(([fx, fy]) =>
          el('circle', { cx: lx + lw * fx, cy: ly + lh * fy, r: T * 0.035, fill: frame }, layers.terrain));
      } else {
        el('circle', { cx: cx + (vertical ? T * 0.40 : T * 0.5), cy: cy + (vertical ? T * 0.5 : T * 0.40), r: T * 0.05, fill: frame }, layers.terrain);
        [0.34, 0.66].forEach(f => vertical    // wooden planks
          ? el('line', { x1: lx, y1: ly + lh * f, x2: lx + lw, y2: ly + lh * f, stroke: frame, 'stroke-width': 1 }, layers.terrain)
          : el('line', { x1: lx + lw * f, y1: ly, x2: lx + lw * f, y2: ly + lh, stroke: frame, 'stroke-width': 1 }, layers.terrain));
      }
    }
  }

  function drawWindow(x, y, T, C) {
    const smashed = LS.los.windowSmashed(x, y);
    const vertical = LS.los.isBarrier(x, y - 1) && LS.los.isBarrier(x, y + 1);
    const cx = x * T, cy = y * T;
    const px = vertical ? cx + T * 0.30 : cx + T * 0.08;
    const py = vertical ? cy + T * 0.08 : cy + T * 0.30;
    const pw = vertical ? T * 0.40 : T * 0.84;
    const ph = vertical ? T * 0.84 : T * 0.40;
    if (!smashed) {
      el('rect', { x: px, y: py, width: pw, height: ph, fill: C.glass, stroke: C.glassEdge, 'stroke-width': 2 }, layers.terrain);
      el('line', { x1: px + pw / 2, y1: py, x2: px + pw / 2, y2: py + ph, stroke: C.glassEdge, 'stroke-width': 1 }, layers.terrain);
      el('line', { x1: px, y1: py + ph / 2, x2: px + pw, y2: py + ph / 2, stroke: C.glassEdge, 'stroke-width': 1 }, layers.terrain);
      el('line', { x1: px + pw * 0.22, y1: py + ph * 0.12, x2: px + pw * 0.5, y2: py + ph * 0.46, stroke: 'rgba(255,255,255,0.4)', 'stroke-width': 2, 'stroke-linecap': 'round' }, layers.terrain); // glint
    } else {
      el('rect', { x: px, y: py, width: pw, height: ph, fill: '#10131a', stroke: C.glassEdge, 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }, layers.terrain);
      el('polygon', { points: `${px},${py} ${px + pw * 0.32},${py} ${px},${py + ph * 0.38}`, fill: C.glassEdge, opacity: 0.5 }, layers.terrain);
      el('polygon', { points: `${px + pw},${py + ph} ${px + pw - pw * 0.32},${py + ph} ${px + pw},${py + ph - ph * 0.38}`, fill: C.glassEdge, opacity: 0.5 }, layers.terrain);
    }
  }

  // decor objects: low cover (crate, desk) reads short and open-topped; tall cover (locker,
  // console) fills the tile and reads solid, since it blocks sight.
  function drawDecor(x, y, T, C, ch) {
    if (ch === 'c') drawCrate(x, y, T, C);
    else if (ch === 't') drawDesk(x, y, T, C);
    else if (ch === 'L') drawLocker(x, y, T, C);
    else if (ch === 'M') drawConsole(x, y, T, C);
  }

  function drawCrate(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.17;
    const x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0, y: y0 + h * 0.08, width: w, height: h * 0.92, rx: 2, fill: C.crateBody, stroke: C.crateEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.26, rx: 2, fill: C.crateTop }, layers.terrain); // lid (lighter top face)
    el('line', { x1: x0, y1: y0 + h * 0.3, x2: x0 + w, y2: y0 + h, stroke: C.crateBrace, 'stroke-width': 2 }, layers.terrain); // X brace
    el('line', { x1: x0 + w, y1: y0 + h * 0.3, x2: x0, y2: y0 + h, stroke: C.crateBrace, 'stroke-width': 2 }, layers.terrain);
  }

  function drawDesk(x, y, T, C) {
    const cx = x * T, cy = y * T;
    const x0 = cx + T * 0.12, w = T * 0.76, y0 = cy + T * 0.30, h = T * 0.34;
    [0.18, 0.74].forEach(fx => el('rect', { x: cx + T * fx, y: y0 + h * 0.6, width: T * 0.08, height: T * 0.26, fill: C.deskLeg }, layers.terrain)); // legs
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.deskTop, stroke: 'rgba(0,0,0,0.32)', 'stroke-width': 1 }, layers.terrain); // surface
    el('line', { x1: x0, y1: y0 + h * 0.55, x2: x0 + w, y2: y0 + h * 0.55, stroke: 'rgba(0,0,0,0.18)', 'stroke-width': 1 }, layers.terrain);
  }

  function drawLocker(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.12;
    const x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.lockerBody, stroke: C.lockerEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0, y: y0, width: w, height: h * 0.12, fill: 'rgba(255,255,255,0.06)' }, layers.terrain); // top highlight
    el('line', { x1: x0 + w / 2, y1: y0, x2: x0 + w / 2, y2: y0 + h, stroke: C.lockerEdge, 'stroke-width': 1.5 }, layers.terrain); // twin doors
    [0.34, 0.66].forEach(fx => el('rect', { x: x0 + w * fx - T * 0.015, y: y0 + h * 0.42, width: T * 0.03, height: h * 0.16, rx: 1, fill: C.lockerHandle }, layers.terrain)); // handles
  }

  function drawConsole(x, y, T, C) {
    const cx = x * T, cy = y * T, p = T * 0.12;
    const x0 = cx + p, y0 = cy + p, w = T - 2 * p, h = T - 2 * p;
    el('rect', { x: x0, y: y0, width: w, height: h, rx: 2, fill: C.consoleBody, stroke: C.consoleEdge, 'stroke-width': 1.5 }, layers.terrain);
    el('rect', { x: x0 + w * 0.16, y: y0 + h * 0.14, width: w * 0.68, height: h * 0.40, rx: 1, fill: '#0c0f12', stroke: C.consoleEdge, 'stroke-width': 1 }, layers.terrain); // screen well
    el('rect', { x: x0 + w * 0.16, y: y0 + h * 0.14, width: w * 0.68, height: h * 0.40, rx: 1, fill: C.consoleScreen }, layers.terrain); // dim glow
    [0.26, 0.40].forEach(fy => el('line', { x1: x0 + w * 0.18, y1: y0 + h * fy, x2: x0 + w * 0.82, y2: y0 + h * fy, stroke: 'rgba(0,0,0,0.22)', 'stroke-width': 1 }, layers.terrain)); // scan lines
    [0.32, 0.5, 0.68].forEach(fx => el('circle', { cx: x0 + w * fx, cy: y0 + h * 0.74, r: T * 0.03, fill: C.lockerHandle }, layers.terrain)); // buttons
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
        const fireCost = LS.level.weapon.fireCost;
        reach.cost.forEach((c, k) => {
          if (c === 0) return; // skip the unit's own tile
          const x = k % LS.config.cols, y = Math.floor(k / LS.config.cols);
          // full colour if you'd still have AP banked to react; grey if moving here spends you out
          const fill = (sel.ap - c) >= fireCost ? armedFill : C.reachSpent;
          const dangerous = danger.has(k); // red outline = a spotted enemy can shoot you here
          el('rect', {
            x: x * T + 2, y: y * T + 2, width: T - 4, height: T - 4, rx: 4, fill,
            stroke: dangerous ? C.target : 'none', 'stroke-width': dangerous ? 2 : 0,
          }, layers.overlay);
        });
        if (sel.ap >= LS.level.weapon.fireCost) {
          LS.game.teamUnits(sel.team === 'blue' ? 'red' : 'blue').forEach(t => {
            if (LS.los.canTarget(sel, t.x, t.y)) drawReticle(t.x, t.y, T, C);
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
  const SPRITE = { steel: '#23262e', steelLt: '#5a6470', steelHi: '#828c98', visor: '#0c1a2e' };
  function teamPal(team) {
    return team === 'blue'
      ? { base: LS.config.colors.blue, dk: '#245a93', lt: '#bfe0ff', glow: '#7fd0ff' }
      : { base: LS.config.colors.red, dk: '#9e3535', lt: '#ffc7c7', glow: '#ff9a9a' };
  }
  function mShadow(g, T) { el('ellipse', { cx: 0, cy: T * 0.4, rx: T * 0.3, ry: T * 0.09, fill: 'rgba(0,0,0,0.32)' }, g); }
  function mBoots(g, T, t, spread) {
    const dx = T * (spread || 0.12);
    [-dx, dx].forEach(x => el('rect', { x: x - T * 0.075, y: T * 0.26, width: T * 0.15, height: T * 0.16, rx: T * 0.05, fill: SPRITE.steel, stroke: t.dk, 'stroke-width': 1.5 }, g));
  }
  function mGun(g, T, ox, oy, L, rot) {
    const grp = el('g', { transform: `translate(${ox},${oy}) rotate(${rot || 0})` }, g);
    el('rect', { x: -L * 0.42, y: -T * 0.04, width: L * 0.22, height: T * 0.12, rx: 2, fill: SPRITE.steelLt }, grp);   // stock
    el('rect', { x: -L * 0.22, y: -T * 0.06, width: L * 0.4, height: T * 0.14, rx: 2, fill: SPRITE.steel }, grp);      // receiver
    el('rect', { x: -L * 0.06, y: T * 0.05, width: L * 0.13, height: T * 0.18, rx: 2, fill: SPRITE.steel, transform: `rotate(12 0 ${T * 0.06})` }, grp); // magazine
    el('rect', { x: 0, y: -T * 0.12, width: L * 0.09, height: T * 0.07, fill: SPRITE.steel }, grp);                    // sight
    el('rect', { x: L * 0.12, y: -T * 0.028, width: L * 0.5, height: T * 0.06, rx: 1.5, fill: SPRITE.steel }, grp);    // barrel
    el('rect', { x: L * 0.58, y: -T * 0.045, width: L * 0.1, height: T * 0.09, rx: 1.5, fill: SPRITE.steelHi }, grp);  // muzzle
  }
  function mHelmet(g, t, hx, hy, hr, dx, dy, dome, shine, nose) {
    if (nose) {
      const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux, nb = hr * 0.38;
      el('polygon', { points: `${hx + ux * hr * 1.55},${hy + uy * hr * 1.55} ${hx + ux * hr * 0.6 + px * nb},${hy + uy * hr * 0.6 + py * nb} ${hx + ux * hr * 0.6 - px * nb},${hy + uy * hr * 0.6 - py * nb}`, fill: dome, stroke: t.dk, 'stroke-width': 1.5 }, g);
    }
    el('ellipse', { cx: hx, cy: hy, rx: hr, ry: hr * 0.92, fill: dome, stroke: t.dk, 'stroke-width': 2 }, g);
    if (shine) el('circle', { cx: hx - hr * 0.34, cy: hy - hr * 0.42, r: hr * 0.2, fill: 'rgba(255,255,255,0.45)' }, g);
  }
  const MARINE_POSES = {
    front(g, T, t) {
      mShadow(g, T); mBoots(g, T, t);
      el('rect', { x: -T * 0.16, y: T * 0.04, width: T * 0.32, height: T * 0.26, rx: T * 0.06, fill: t.dk }, g);
      el('rect', { x: -T * 0.2, y: -T * 0.16, width: T * 0.4, height: T * 0.3, rx: T * 0.1, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
      el('rect', { x: -T * 0.1, y: -T * 0.1, width: T * 0.2, height: T * 0.18, rx: T * 0.04, fill: t.lt, opacity: 0.5 }, g);
      [-1, 1].forEach(s => el('ellipse', { cx: s * T * 0.24, cy: -T * 0.13, rx: T * 0.12, ry: T * 0.13, fill: t.dk }, g));
      mGun(g, T, -T * 0.04, T * 0.07, T * 0.46, -7);
      mHelmet(g, t, 0, -T * 0.29, T * 0.2, 0, 1, t.base, true, true);
      el('rect', { x: -T * 0.15, y: -T * 0.27, width: T * 0.3, height: T * 0.12, rx: T * 0.05, fill: SPRITE.visor }, g);
      el('rect', { x: -T * 0.09, y: -T * 0.24, width: T * 0.12, height: T * 0.045, rx: 2, fill: t.glow, opacity: 0.85 }, g);
    },
    side(g, T, t) {
      mShadow(g, T); mBoots(g, T, t, 0.1);
      el('rect', { x: -T * 0.14, y: T * 0.04, width: T * 0.26, height: T * 0.26, rx: T * 0.06, fill: t.dk }, g);
      el('ellipse', { cx: -T * 0.22, cy: -T * 0.08, rx: T * 0.12, ry: T * 0.16, fill: t.dk }, g);
      el('rect', { x: -T * 0.16, y: -T * 0.16, width: T * 0.32, height: T * 0.3, rx: T * 0.1, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
      el('ellipse', { cx: T * 0.02, cy: -T * 0.13, rx: T * 0.12, ry: T * 0.13, fill: t.dk }, g);
      mGun(g, T, T * 0.04, 0, T * 0.5, 0);
      mHelmet(g, t, T * 0.04, -T * 0.29, T * 0.2, 1, 0, t.base, true, true);
      el('rect', { x: T * 0.1, y: -T * 0.33, width: T * 0.2, height: T * 0.12, rx: T * 0.05, fill: SPRITE.visor }, g);
      el('rect', { x: T * 0.18, y: -T * 0.3, width: T * 0.08, height: T * 0.045, rx: 2, fill: t.glow, opacity: 0.85 }, g);
    },
    back(g, T, t) {
      mShadow(g, T); mBoots(g, T, t);
      el('rect', { x: -T * 0.16, y: T * 0.04, width: T * 0.32, height: T * 0.26, rx: T * 0.06, fill: t.dk }, g);
      el('rect', { x: -T * 0.2, y: -T * 0.16, width: T * 0.4, height: T * 0.3, rx: T * 0.1, fill: t.dk, stroke: t.dk, 'stroke-width': 2 }, g);
      el('rect', { x: -T * 0.13, y: -T * 0.12, width: T * 0.26, height: T * 0.24, rx: T * 0.06, fill: SPRITE.steel }, g);
      el('rect', { x: -T * 0.08, y: -T * 0.08, width: T * 0.16, height: T * 0.07, rx: 2, fill: t.glow, opacity: 0.5 }, g);
      [-1, 1].forEach(s => el('ellipse', { cx: s * T * 0.24, cy: -T * 0.13, rx: T * 0.12, ry: T * 0.13, fill: t.dk }, g));
      mHelmet(g, t, 0, -T * 0.29, T * 0.2, 0, -1, t.dk, false, false);
      el('circle', { cx: 0, cy: -T * 0.3, r: T * 0.07, fill: SPRITE.steel }, g);
    },
    threeqFront(g, T, t) {
      mShadow(g, T); mBoots(g, T, t, 0.11);
      el('rect', { x: -T * 0.15, y: T * 0.04, width: T * 0.3, height: T * 0.26, rx: T * 0.06, fill: t.dk }, g);
      el('ellipse', { cx: -T * 0.2, cy: -T * 0.1, rx: T * 0.11, ry: T * 0.14, fill: t.dk }, g);
      el('rect', { x: -T * 0.18, y: -T * 0.16, width: T * 0.36, height: T * 0.3, rx: T * 0.1, fill: t.base, stroke: t.dk, 'stroke-width': 2 }, g);
      el('rect', { x: -T * 0.06, y: -T * 0.1, width: T * 0.18, height: T * 0.16, rx: T * 0.04, fill: t.lt, opacity: 0.45 }, g);
      el('ellipse', { cx: T * 0.18, cy: -T * 0.13, rx: T * 0.12, ry: T * 0.13, fill: t.dk }, g);
      mGun(g, T, -T * 0.02, T * 0.06, T * 0.48, 26);
      mHelmet(g, t, T * 0.05, -T * 0.29, T * 0.2, 0.7, 0.7, t.base, true, true);
      el('rect', { x: -T * 0.02, y: -T * 0.31, width: T * 0.26, height: T * 0.12, rx: T * 0.05, fill: SPRITE.visor, transform: `rotate(20 ${T * 0.05} ${-T * 0.25})` }, g);
      el('rect', { x: T * 0.07, y: -T * 0.27, width: T * 0.09, height: T * 0.045, rx: 2, fill: t.glow, opacity: 0.85 }, g);
    },
    backThreeq(g, T, t) {
      mShadow(g, T); mBoots(g, T, t, 0.11);
      el('rect', { x: -T * 0.15, y: T * 0.04, width: T * 0.3, height: T * 0.26, rx: T * 0.06, fill: t.dk }, g);
      el('rect', { x: -T * 0.18, y: -T * 0.16, width: T * 0.36, height: T * 0.3, rx: T * 0.1, fill: t.dk, stroke: t.dk, 'stroke-width': 2 }, g);
      el('rect', { x: -T * 0.14, y: -T * 0.12, width: T * 0.22, height: T * 0.22, rx: T * 0.05, fill: SPRITE.steel }, g); // backpack (far side)
      el('ellipse', { cx: T * 0.2, cy: -T * 0.12, rx: T * 0.12, ry: T * 0.13, fill: t.dk }, g);   // near pauldron
      el('ellipse', { cx: -T * 0.22, cy: -T * 0.13, rx: T * 0.1, ry: T * 0.12, fill: t.dk }, g);  // far pauldron
      el('rect', { x: T * 0.04, y: -T * 0.04, width: T * 0.34, height: T * 0.08, rx: 1.5, fill: SPRITE.steel, transform: `rotate(-22 ${T * 0.1} 0)` }, g); // gun tip
      mHelmet(g, t, T * 0.05, -T * 0.29, T * 0.2, 0, -1, t.dk, false, false);
      el('circle', { cx: T * 0.02, cy: -T * 0.3, r: T * 0.06, fill: SPRITE.steel }, g);
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

  function drawUnits(T, C) {
    clear(layers.units);
    for (const id in unitEls) delete unitEls[id];
    const viewer = LS.game.viewTeam();
    LS.state.units.filter(u => u.alive).forEach(u => {
      if (u.team !== viewer && !vision.has(LS.game.key(u.x, u.y)) && !revealed.has(u.id)) return; // hidden by fog
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
      if (!adj && sel.ap >= LS.level.weapon.fireCost && LS.los.canTarget(sel, tx, ty)) { label('shoot glass', tx * T + T / 2, ty * T - 6, C.target, T); return; }
    }

    // hit-chance readout over a targetable enemy (reflects cover)
    if (hovVisible && hov.team !== sel.team && sel.ap >= LS.level.weapon.fireCost && LS.los.canTarget(sel, tx, ty)) {
      const ch = LS.game.hitChance(sel, tx, ty);
      const cover = LS.game.inCoverFrom(tx, ty, sel.x, sel.y);
      label(`${Math.round(ch * 100)}%${cover ? ' · cover' : ''}`, tx * T + T / 2, ty * T - 6, C.target, T);
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
  function animateStep(unit, from, to, done) {
    const ue = unitEls[unit.id], g = ue && ue.g, action = ue && ue.action, T = LS.config.tile;
    const x1 = to.x * T + T / 2, y1 = to.y * T + T / 2;
    if (!g || !LS.config.anim.enabled) { if (g) g.setAttribute('transform', `translate(${x1},${y1})`); done(); return; }
    const x0 = from.x * T + T / 2, y0 = from.y * T + T / 2, dur = LS.config.anim.msPerTile;
    LS.sound.play('step'); // one footfall per tile of the walk
    let start = null;
    function f(ts) {
      if (start === null) start = ts;
      let p = (ts - start) / dur; if (p > 1) p = 1;
      g.setAttribute('transform', `translate(${x0 + (x1 - x0) * p},${y0 + (y1 - y0) * p})`);
      if (action) action.setAttribute('transform', `translate(0,${-Math.abs(Math.sin(p * Math.PI * 3)) * 2.5})`); // walk bob
      if (p < 1) requestAnimationFrame(f); else { if (action) action.removeAttribute('transform'); done(); }
    }
    requestAnimationFrame(f);
  }

  // --- shot feedback: muzzle flash, travelling bolt, impact, floating damage/miss ---
  function shotFx(shooter, target, result, done) {
    LS.sound.play('fire');
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

    fade(el('circle', { cx: sx, cy: sy, r: T * 0.16, fill: '#ffe9a8', opacity: 0.95 }, layers.fx), 180);

    const bolt = el('line', { x1: sx, y1: sy, x2: sx, y2: sy, stroke: '#ffe08a', 'stroke-width': 3, 'stroke-linecap': 'round' }, layers.fx);
    const dur = 190; let start = null;
    function fly(ts) {
      if (start === null) start = ts;
      let p = (ts - start) / dur; if (p > 1) p = 1;
      const tailP = Math.max(0, p - 0.25);
      bolt.setAttribute('x1', sx + (ex - sx) * tailP); bolt.setAttribute('y1', sy + (ey - sy) * tailP);
      bolt.setAttribute('x2', sx + (ex - sx) * p); bolt.setAttribute('y2', sy + (ey - sy) * p);
      if (p < 1) requestAnimationFrame(fly); else { bolt.remove(); impact(); }
    }
    requestAnimationFrame(fly);

    function impact() {
      if (result.glass) { LS.sound.play('glass'); glassBurst(tcx, tcy); setTimeout(() => done && done(), 160); return; }
      if (result.hit) {
        LS.sound.play(result.killed ? 'down' : 'hit');
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

  return { init, draw, drawHover, drawFacing, animateStep, refaceUnit, shotFx, glassFx, throwArc, explosionFx, setCamera, centerOn, panBy, followUnit, contactMoment, focusTile, reveal, unreveal, unitEls };
})();
