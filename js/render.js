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
    const { cols, rows, tile } = LS.config;
    svg.setAttribute('viewBox', `0 0 ${cols * tile} ${rows * tile}`);
    // 'threat' sits above 'overlay' so enemy danger reads red over the blue move-field, not muddy purple
    ['terrain', 'fog', 'overlay', 'threat', 'units', 'facing', 'hover'].forEach(name => {
      layers[name] = el('g', { id: 'layer-' + name }, svg);
    });
  }

  function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  let vision = new Set(), danger = new Set();   // active team's current sight + known danger (set in draw)

  function draw() {
    const T = LS.config.tile, C = LS.config.colors;
    vision = LS.game.teamVision(LS.state.activeTeam);
    danger = LS.game.enemyDangerSet(LS.state.activeTeam, vision);
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
  }

  function drawTerrain(T, C) {
    clear(layers.terrain);
    for (let y = 0; y < LS.config.rows; y++) {
      for (let x = 0; x < LS.config.cols; x++) {
        const ch = LS.level.map[y][x];
        let fill;
        if (ch === '#') fill = C.wall;
        else if (ch === '_') fill = (x + y) % 2 ? C.floorB : C.floorA;
        else if (ch === 'D') fill = C.door;
        else fill = (x + y) % 2 ? C.groundB : C.groundA;
        el('rect', { x: x * T, y: y * T, width: T, height: T, fill }, layers.terrain);
        if (ch === '#') {
          // a little top highlight so walls read as solid
          el('rect', { x: x * T, y: y * T, width: T, height: T * 0.22, fill: C.wallTop }, layers.terrain);
        }
        el('rect', { x: x * T, y: y * T, width: T, height: T, fill: 'none', stroke: C.grid, 'stroke-width': 1 }, layers.terrain);
      }
    }
  }

  function drawOverlay(T, C) {
    clear(layers.overlay);
    const sel = LS.game.selected();
    const reach = LS.state.reach;
    // movement field for the selected unit
    if (sel && reach && !LS.state.busy) {
      const armedFill = sel.team === 'blue' ? C.reachBlue : C.reachRed;
      const fireCost = LS.level.weapon.fireCost;
      reach.cost.forEach((c, k) => {
        if (c === 0) return; // skip the unit's own tile
        const x = k % LS.config.cols, y = Math.floor(k / LS.config.cols);
        // full colour if you'd still have AP banked to react; grey if moving here spends you out
        const fill = (sel.ap - c) >= fireCost ? armedFill : C.reachSpent;
        // red outline = a spotted enemy can shoot you on this tile (fair: only from enemies you can see)
        const dangerous = danger.has(k);
        el('rect', {
          x: x * T + 2, y: y * T + 2, width: T - 4, height: T - 4, rx: 4, fill,
          stroke: dangerous ? C.target : 'none', 'stroke-width': dangerous ? 2 : 0,
        }, layers.overlay);
      });
      // targetable enemies
      if (sel.ap >= LS.level.weapon.fireCost) {
        LS.game.teamUnits(sel.team === 'blue' ? 'red' : 'blue').forEach(t => {
          if (LS.los.canTarget(sel, t.x, t.y)) drawReticle(t.x, t.y, T, C);
        });
      }
    }
  }

  function drawReticle(x, y, T, C) {
    const cx = x * T + T / 2, cy = y * T + T / 2, r = T * 0.46;
    el('circle', { cx, cy, r, fill: 'none', stroke: C.target, 'stroke-width': 2, 'stroke-dasharray': '4 4', opacity: 0.9 }, layers.overlay);
    const arm = T * 0.18;
    [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy]) => {
      el('line', { x1: cx + dx * (r - arm), y1: cy + dy * (r - arm), x2: cx + dx * r, y2: cy + dy * r, stroke: C.target, 'stroke-width': 2 }, layers.overlay);
    });
  }

  function drawUnits(T, C) {
    clear(layers.units);
    for (const id in unitEls) delete unitEls[id];
    const active = LS.state.activeTeam;
    LS.state.units.filter(u => u.alive).forEach(u => {
      if (u.team !== active && !vision.has(LS.game.key(u.x, u.y))) return; // hidden by fog
      const cx = u.x * T + T / 2, cy = u.y * T + T / 2;
      const g = el('g', { transform: `translate(${cx},${cy})` }, layers.units);
      unitEls[u.id] = g;
      const body = u.team === 'blue' ? C.blue : C.red;
      const ring = u.team === 'blue' ? C.blueDark : C.redDark;

      if (LS.state.selectedId === u.id) {
        el('circle', { cx: 0, cy: 0, r: T * 0.44, fill: 'none', stroke: C.select, 'stroke-width': 2.5, 'stroke-dasharray': '5 4' }, g);
      }
      el('circle', { cx: 0, cy: 0, r: T * 0.32, fill: body, stroke: ring, 'stroke-width': 2 }, g);

      // facing notch
      const f = LS.DIRS[u.facing];
      const ang = Math.atan2(f.dy, f.dx) * 180 / Math.PI;
      const notch = el('g', { transform: `rotate(${ang})` }, g);
      const r = T * 0.32;
      el('polygon', { points: `${r - 2},0 ${r + 6},-5 ${r + 6},5`, fill: '#fff', opacity: 0.92 }, notch);

      // health bar above the unit
      const bw = T * 0.5, bh = 4, bx = -bw / 2, by = -T * 0.46;
      el('rect', { x: bx, y: by, width: bw, height: bh, rx: 2, fill: 'rgba(0,0,0,0.55)' }, g);
      el('rect', { x: bx, y: by, width: bw * (u.hp / u.maxHp), height: bh, rx: 2, fill: u.hp / u.maxHp > 0.4 ? '#6bd86b' : '#e0b13a' }, g);
    });
    drawGhosts(T, C, active);
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
    const fill = u.team !== LS.state.activeTeam ? LS.config.colors.threatEnemy : LS.config.colors.threatAlly;
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
    const hov = LS.game.unitAt(tx, ty);
    // a fogged enemy must not leak through the hover readouts
    const hovVisible = hov && (hov.team === LS.state.activeTeam || vision.has(LS.game.key(tx, ty)));
    if (hovVisible) drawThreat(hov, T);

    const sel = LS.game.selected();
    if (!sel) return;

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
    const g = unitEls[unit.id], T = LS.config.tile;
    const x1 = to.x * T + T / 2, y1 = to.y * T + T / 2;
    if (!g || !LS.config.anim.enabled) { if (g) g.setAttribute('transform', `translate(${x1},${y1})`); done(); return; }
    const x0 = from.x * T + T / 2, y0 = from.y * T + T / 2, dur = LS.config.anim.msPerTile;
    let start = null;
    function f(ts) {
      if (start === null) start = ts;
      let p = (ts - start) / dur; if (p > 1) p = 1;
      g.setAttribute('transform', `translate(${x0 + (x1 - x0) * p},${y0 + (y1 - y0) * p})`);
      if (p < 1) requestAnimationFrame(f); else done();
    }
    requestAnimationFrame(f);
  }

  // a reaction-fire flash: tracer line + ring + "!" over the shooter, then done() after a beat
  function tracer(shooter, target, done) {
    if (!LS.config.anim.enabled) { done && done(); return; }
    const T = LS.config.tile, C = LS.config.colors;
    const x1 = shooter.x * T + T / 2, y1 = shooter.y * T + T / 2;
    const x2 = target.x * T + T / 2, y2 = target.y * T + T / 2;
    el('line', { x1, y1, x2, y2, stroke: '#ffe08a', 'stroke-width': 2.5, opacity: 0.95, 'stroke-linecap': 'round' }, layers.hover);
    el('circle', { cx: x1, cy: y1, r: T * 0.42, fill: 'none', stroke: C.target, 'stroke-width': 3, opacity: 0.9 }, layers.hover);
    const t = el('text', { x: x1, y: y1 - T * 0.5, fill: C.target, 'font-size': 16, 'font-weight': 800, 'text-anchor': 'middle', 'font-family': 'monospace' }, layers.hover);
    t.textContent = '!';
    setTimeout(() => { done && done(); }, 200);
  }

  return { init, draw, drawHover, drawFacing, animateStep, tracer, unitEls };
})();
