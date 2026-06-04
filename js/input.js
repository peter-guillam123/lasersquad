// input.js — all mouse interaction. Click → mutate state via LS.game → redraw.
LS.input = (function () {
  let svg, hoverTile = { x: null, y: null }, hoverDir = -1, hoverQueued = false;

  function pointFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    const { cols, rows, tile } = LS.config;
    return {
      px: (e.clientX - rect.left) * (cols * tile) / rect.width,
      py: (e.clientY - rect.top) * (rows * tile) / rect.height,
    };
  }

  function tileFromEvent(e) {
    const { px, py } = pointFromEvent(e);
    const { cols, rows, tile } = LS.config;
    const x = Math.floor(px / tile), y = Math.floor(py / tile);
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return { x, y };
  }

  // which facing arrow (if any) sits under this point — the ring around the selected soldier
  function ringDirAt(px, py) {
    const u = LS.game.selected();
    if (!u || u.team !== LS.state.activeTeam || LS.state.busy || LS.state.over) return -1;
    const T = LS.config.tile;
    const dx = px - (u.x * T + T / 2), dy = py - (u.y * T + T / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < T * 0.36 || dist > T * 0.80) return -1;   // band hugs the soldier; tile centres lie outside it
    return LS.util.nearestDir(dx, dy);
  }

  function onClick(e) {
    if (LS.state.busy || LS.state.over || LS.state.handoff) return;
    const { px, py } = pointFromEvent(e);
    const rd = ringDirAt(px, py);
    if (rd >= 0) { LS.game.selected().facing = rd; LS.game.observe(); LS.render.draw(); return; }
    const t = tileFromEvent(e);
    if (!t) return;
    handle(t.x, t.y);
  }

  function handle(tx, ty) {
    const sel = LS.game.selected();
    let clicked = LS.game.unitAt(tx, ty);
    // a fogged enemy isn't something the player can knowingly click — treat the tile as empty
    if (clicked && clicked.team !== LS.state.activeTeam && !LS.game.isVisible(clicked)) clicked = null;

    // select your own soldier
    if (clicked && clicked.team === LS.state.activeTeam) {
      LS.game.selectUnit(clicked.id);
      LS.render.draw();
      return;
    }

    if (sel) {
      // fire on an enemy
      if (clicked && clicked.team !== sel.team) {
        const res = LS.game.fire(sel, clicked);
        if (!res.ok) LS.game.log(res.reason);
        LS.render.draw();
        return;
      }
      // empty tile: move if reachable; out-of-range clicks do nothing (turning is via the ring)
      if (!clicked) {
        const reach = LS.state.reach;
        const k = LS.game.key(tx, ty);
        if (reach && reach.cost.has(k) && reach.cost.get(k) > 0) {
          beginMove(sel, LS.game.pathTo(reach, tx, ty));
        }
        return;
      }
    }

    // clicked empty space / enemy with nothing selected → clear selection
    LS.game.selectUnit(null);
    LS.render.draw();
  }

  // walk a path one tile at a time, halting if a reaction shot lands (halt-on-spot)
  function beginMove(unit, path) {
    LS.state.busy = true;
    LS.ui.update();
    let i = 1;
    function stepOne() {
      if (i >= path.length) return endMove();
      const from = path[i - 1], to = path[i];
      LS.render.animateStep(unit, from, to, () => {
        LS.game.applyStep(unit, from, to);
        const reactors = LS.game.findReactors(unit);
        if (reactors.length) resolveReactions(unit, reactors, endMove);
        else { i++; stepOne(); }
      });
    }
    stepOne();
  }

  function resolveReactions(mover, reactors, done) {
    let j = 0;
    function next() {
      if (j >= reactors.length || !mover.alive) return done();
      const r = reactors[j++];
      if (r.ap < LS.level.weapon.fireCost || !LS.los.canSee(r, mover.x, mover.y)) return next();
      LS.render.tracer(r, mover, () => {
        LS.game.fire(r, mover, { reaction: true });
        LS.render.draw();
        if (LS.config.anim.enabled) setTimeout(next, 240); else next();
      });
    }
    next();
  }

  function endMove() {
    LS.state.busy = false;
    const sel = LS.game.selected();
    if (sel && !sel.alive) LS.game.selectUnit(null);
    LS.game.refreshReach();
    LS.render.draw();
  }

  function onMove(e) {
    if (LS.state.busy || LS.state.handoff) return;
    const { px, py } = pointFromEvent(e);
    const rd = ringDirAt(px, py);
    const t = tileFromEvent(e);
    const nx = t ? t.x : null, ny = t ? t.y : null;
    if (nx === hoverTile.x && ny === hoverTile.y && rd === hoverDir) return;
    hoverTile = { x: nx, y: ny }; hoverDir = rd;
    if (!hoverQueued) {
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        LS.render.drawFacing(hoverDir);
        LS.render.drawHover(hoverDir >= 0 ? null : hoverTile.x, hoverDir >= 0 ? null : hoverTile.y);
      });
    }
  }

  function init() {
    svg = document.getElementById('board');
    svg.addEventListener('click', onClick);
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', () => { hoverDir = -1; LS.render.drawFacing(-1); LS.render.drawHover(null, null); });
    document.getElementById('end-turn').addEventListener('click', () => {
      if (LS.state.busy) return;
      LS.game.endTurn();
      LS.render.draw();
    });
    // click a roster pip to select that soldier (if it's yours and your turn)
    document.querySelector('.rosters').addEventListener('click', (e) => {
      const pip = e.target.closest('.pip');
      if (!pip || LS.state.busy || LS.state.over) return;
      const u = LS.game.unitById(pip.dataset.id);
      if (u && u.alive && u.team === LS.state.activeTeam) {
        LS.game.selectUnit(u.id);
        LS.render.draw();
      }
    });
    document.getElementById('restart').addEventListener('click', () => {
      LS.game.newGame();
      LS.game.refreshReach();
      LS.render.draw();
    });
    document.getElementById('handoff-btn').addEventListener('click', () => {
      LS.game.resumeTurn();
      LS.render.draw();
    });
  }

  return { init };
})();
