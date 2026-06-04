// input.js — all mouse interaction. Click → mutate state via LS.game → redraw.
LS.input = (function () {
  let svg, hoverTile = { x: null, y: null }, hoverDir = -1, hoverQueued = false;

  function pointFromEvent(e) {
    const rect = svg.getBoundingClientRect();
    const { tile, view } = LS.config, cam = LS.state.cam;
    // map screen pixels into world pixels through the camera window
    return {
      px: cam.x + (e.clientX - rect.left) / rect.width * (view.cols * tile),
      py: cam.y + (e.clientY - rect.top) / rect.height * (view.rows * tile),
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

  // is this point on the ✕ close-badge of an open door next to the selected soldier? (mirrors render)
  function closeBadgeAt(px, py) {
    const sel = LS.game.selected();
    if (!sel || sel.team !== LS.state.activeTeam) return null;
    const T = LS.config.tile;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = sel.x + dx, y = sel.y + dy;
      if (LS.los.isDoor(x, y) && LS.los.doorOpen(x, y)) {
        if (Math.hypot(px - (x * T + T * 0.78), py - (y * T + T * 0.22)) <= T * 0.24) return { x, y };
      }
    }
    return null;
  }

  function onClick(e) {
    LS.sound.ensure(); // first real click unlocks audio (browser autoplay rules)
    if (LS.state.busy || LS.state.over || LS.state.handoff) return;
    // grenade aiming intercepts everything: click a valid tile to throw, anywhere else to cancel
    if (LS.state.throwMode) {
      const sel = LS.game.selected(), t = tileFromEvent(e);
      if (sel && t && LS.game.canThrowTo(sel, t.x, t.y)) performThrow(sel, t.x, t.y);
      else { LS.state.throwMode = null; LS.render.draw(); }
      return;
    }
    const { px, py } = pointFromEvent(e);
    const rd = ringDirAt(px, py);
    if (rd >= 0) { LS.game.selected().facing = rd; LS.game.observe(); LS.render.draw(); return; }
    const cb = closeBadgeAt(px, py);
    if (cb) {
      const r = LS.game.toggleDoor(LS.game.selected(), cb.x, cb.y);
      if (r.ok) LS.sound.play('door'); else if (r.reason) LS.game.log(r.reason);
      LS.render.draw();
      return;
    }
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
      LS.render.followUnit(clicked);
      LS.render.draw();
      return;
    }

    if (sel) {
      // closed door: click it (from next to it) to open. An OPEN door is a normal tile —
      // it falls through to the move logic so you can step into and stand in the doorway;
      // closing is done with the ✕ badge (handled in onClick).
      if (LS.los.isDoor(tx, ty) && !LS.los.doorOpen(tx, ty)) {
        const r = LS.game.toggleDoor(sel, tx, ty);
        if (r.ok) LS.sound.play('door'); else if (r.reason) LS.game.log(r.reason);
        LS.render.draw();
        return;
      }
      // intact windows: smash at melee range, or break with a shot from range
      if (LS.los.isWindow(tx, ty) && !LS.los.windowSmashed(tx, ty)) {
        const adj = Math.abs(sel.x - tx) + Math.abs(sel.y - ty) === 1;
        if (adj) {
          const r = LS.game.smashWindowMelee(sel, tx, ty);
          if (r.ok) LS.render.glassFx(tx, ty); else if (r.reason) LS.game.log(r.reason);
          LS.render.draw();
          return;
        }
        if (sel.ap >= LS.level.weapon.fireCost && LS.los.canTarget(sel, tx, ty)) {
          performWindowShot(sel, tx, ty);
          return;
        }
        LS.game.log('Too far to break that window — get closer, or line up a clear shot.');
        LS.render.draw();
        return;
      }
      // fire on an enemy. If glass is in the way, the shot fires and shatters it (stopping there)
      // rather than refusing with "no line of sight".
      if (clicked && clicked.team !== sel.team) {
        if (LS.los.canTarget(sel, clicked.x, clicked.y)) {
          performShot(sel, clicked);
        } else if (sel.ap < LS.level.weapon.fireCost) {
          LS.game.log('Not enough AP to fire.'); LS.render.draw();
        } else {
          const b = LS.los.firstShotBlocker(sel.x, sel.y, clicked.x, clicked.y);
          if (b && LS.los.isWindow(b.x, b.y) && !LS.los.windowSmashed(b.x, b.y)) {
            performWindowShot(sel, b.x, b.y); // shatter the glass between you; the round stops there
          } else {
            LS.game.log('No line of sight.'); LS.render.draw();
          }
        }
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

  // throw a grenade: resolve, animate the arc, then it sits live until end of turn
  function performThrow(unit, x, y) {
    const r = LS.game.throwGrenade(unit, x, y);
    if (!r.ok) { LS.game.log(r.reason); LS.state.throwMode = null; LS.render.draw(); return; }
    LS.state.throwMode = null;
    LS.state.busy = true;
    LS.ui.update();
    LS.render.throwArc(unit, { x, y }, () => {
      LS.state.busy = false;
      LS.render.draw();
    });
  }

  // detonate all cooked grenades (end of turn), one after another, then run `done`
  function detonateLive(done) {
    LS.state.busy = true;
    LS.ui.update();
    const grenades = LS.state.liveGrenades.slice();
    LS.state.liveGrenades = [];
    let i = 0;
    function next() {
      if (i >= grenades.length) {
        LS.game.checkWin();
        LS.render.draw();
        setTimeout(() => { LS.state.busy = false; done(); }, 350); // let the aftermath land before handoff
        return;
      }
      const g = grenades[i++];
      const hits = LS.game.detonateGrenade(g);
      LS.render.explosionFx(g, hits, () => {
        LS.render.draw();
        if (LS.config.anim.enabled) setTimeout(next, 140); else next();
      });
    }
    next();
  }

  // break a window with a shot from range: resolve, animate the bolt shattering it, redraw
  function performWindowShot(unit, x, y) {
    const res = LS.game.shootWindow(unit, x, y);
    if (!res.ok) { LS.game.log(res.reason); LS.render.draw(); return; }
    LS.state.busy = true;
    LS.ui.update();
    LS.render.shotFx(unit, { x, y }, { ok: true, hit: true, glass: true }, () => {
      LS.state.busy = false;
      LS.render.draw();
    });
  }

  // a player-initiated shot: resolve, then play the feedback, then redraw
  function performShot(shooter, target, opts) {
    const res = LS.game.fire(shooter, target, opts || {});
    if (!res.ok) { LS.game.log(res.reason); LS.render.draw(); return; }
    LS.state.busy = true;
    LS.ui.update();
    LS.render.shotFx(shooter, target, res, () => {
      LS.state.busy = false;
      const s = LS.game.selected();
      if (s && !s.alive) LS.game.selectUnit(null);
      LS.render.draw();
    });
  }

  // walk a path one tile at a time, halting if a reaction shot lands (halt-on-spot)
  // rotate a soldier toward `target` facing through the in-between poses, then run done
  function turnTo(unit, target, done) {
    if (unit.facing === target) return done();
    const diff = (target - unit.facing + 8) % 8, step = diff <= 4 ? 1 : -1;
    (function rot() {
      if (unit.facing === target) return done();
      unit.facing = (unit.facing + step + 8) % 8;
      LS.render.refaceUnit(unit);
      setTimeout(rot, 55);
    })();
  }

  function beginMove(unit, path) {
    LS.state.busy = true;
    LS.ui.update();
    let i = 1;
    function stepOne() {
      if (i >= path.length) return endMove();
      LS.render.followUnit(unit); // keep the mover on screen as it advances
      const from = path[i - 1], to = path[i];
      const dir = LS.util.dirIndex(to.x - from.x, to.y - from.y);
      const glide = () => LS.render.animateStep(unit, from, to, () => {
        LS.game.applyStep(unit, from, to);
        const reactors = LS.game.findReactors(unit);
        if (reactors.length) resolveReactions(unit, reactors, endMove);
        else { i++; stepOne(); }
      });
      // turn to face the way we're about to walk first; step straight off if already facing it
      if (LS.config.anim.enabled && unit.facing !== dir) turnTo(unit, dir, glide);
      else { unit.facing = dir; glide(); }
    }
    stepOne();
  }

  function resolveReactions(mover, reactors, done) {
    let j = 0;
    function next() {
      if (j >= reactors.length || !mover.alive) return done();
      const r = reactors[j++];
      if (r.ap < LS.level.weapon.fireCost || !LS.los.canSee(r, mover.x, mover.y)) return next();
      const res = LS.game.fire(r, mover, { reaction: true });
      LS.render.shotFx(r, mover, res, () => {
        LS.render.draw();
        if (LS.config.anim.enabled) setTimeout(next, 180); else next();
      });
    }
    next();
  }

  function endMove() {
    LS.state.busy = false;
    const sel = LS.game.selected();
    if (sel && !sel.alive) LS.game.selectUnit(null);
    else if (sel) LS.render.followUnit(sel);
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

  function centerOnTeam(team) {
    const us = LS.game.teamUnits(team);
    if (!us.length) return;
    const T = LS.config.tile;
    const ax = us.reduce((s, u) => s + u.x, 0) / us.length, ay = us.reduce((s, u) => s + u.y, 0) / us.length;
    LS.render.centerOn(ax * T + T / 2, ay * T + T / 2);
  }

  function init() {
    svg = document.getElementById('board');
    svg.addEventListener('click', onClick);
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mouseleave', () => { hoverDir = -1; LS.render.drawFacing(-1); LS.render.drawHover(null, null); });
    document.getElementById('end-turn').addEventListener('click', () => {
      if (LS.state.busy || LS.state.over || LS.state.handoff) return;
      if (LS.state.liveGrenades.length) {
        detonateLive(() => { LS.game.endTurn(); LS.render.draw(); });
      } else {
        LS.game.endTurn();
        LS.render.draw();
      }
    });
    document.getElementById('throw-btn').addEventListener('click', () => {
      if (LS.state.busy || LS.state.over || LS.state.handoff) return;
      const sel = LS.game.selected();
      if (!sel || sel.team !== LS.state.activeTeam) return;
      if (LS.state.throwMode) {
        LS.state.throwMode = null;
      } else if (sel.grenades <= 0) {
        LS.game.log('No grenades left.');
      } else if (sel.ap < LS.config.grenade.throwCost) {
        LS.game.log('Not enough AP to throw.');
      } else {
        LS.state.throwMode = sel.id;
      }
      LS.render.draw();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && LS.state.throwMode) { LS.state.throwMode = null; LS.render.draw(); return; }
      const T = LS.config.tile;
      const pan = { ArrowLeft: [-T, 0], a: [-T, 0], ArrowRight: [T, 0], d: [T, 0], ArrowUp: [0, -T], w: [0, -T], ArrowDown: [0, T], s: [0, T] }[e.key];
      if (pan) { LS.render.panBy(pan[0], pan[1]); e.preventDefault(); }
    });
    // click a roster pip to select that soldier (if it's yours and your turn)
    document.querySelector('.rosters').addEventListener('click', (e) => {
      const pip = e.target.closest('.pip');
      if (!pip || LS.state.busy || LS.state.over) return;
      const u = LS.game.unitById(pip.dataset.id);
      if (u && u.alive && u.team === LS.state.activeTeam) {
        LS.game.selectUnit(u.id);
        LS.render.followUnit(u);   // pan to it (it may be off-screen)
        LS.render.draw();
      }
    });
    document.getElementById('restart').addEventListener('click', () => {
      LS.game.newGame();
      LS.game.refreshReach();
      LS.render.centerOn(LS.config.tile * 3, LS.config.tile * 9.5);
      LS.render.draw();
    });
    document.getElementById('handoff-btn').addEventListener('click', () => {
      LS.game.resumeTurn();
      centerOnTeam(LS.state.activeTeam); // frame the squad whose turn it now is
      LS.render.draw();
    });
    document.getElementById('mute').addEventListener('click', () => {
      LS.sound.toggle();
      LS.ui.update();
    });
  }

  return { init };
})();
