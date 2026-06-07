// input.js — all mouse interaction. Click → mutate state via LS.game → redraw.
LS.input = (function () {
  let svg, hoverTile = { x: null, y: null }, hoverDir = -1, hoverQueued = false;
  let drag = null, suppressClick = false; // drag-to-pan state
  let endConfirm = false, endConfirmTimer = null; // end-turn guard (a second press confirms)

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
    if (suppressClick) { suppressClick = false; return; } // a drag-to-pan just ended; not a real click
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
      LS.render.followUnit(clicked, true); // glide to it if it's near the edge, don't hard-cut
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
        if (sel.ap >= LS.game.fireAP(sel, 'snap') && LS.los.canTarget(sel, tx, ty)) {
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
        } else if (sel.ap < LS.game.fireAP(sel, LS.state.fireMode)) {
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
    const res = LS.game.fire(shooter, target, opts || { mode: LS.state.fireMode });
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
    let seen = LS.game.visibleEnemyIds(LS.game.viewTeam()); // enemies the watcher already sees when the move began
    function stepOne() {
      if (i >= path.length) return endMove();
      const from = path[i - 1], to = path[i]; // the camera tracks the mover smoothly inside animateStep
      const dir = LS.util.dirIndex(to.x - from.x, to.y - from.y);
      const glide = () => LS.render.animateStep(unit, from, to, () => {
        LS.game.applyStep(unit, from, to);
        const now = LS.game.visibleEnemyIds(LS.game.viewTeam());
        const contacts = [...now].filter(id => !seen.has(id)).map(id => LS.game.unitById(id));
        seen = now;
        const reactors = LS.game.findReactors(unit);
        LS.render.flushAlertCallout(); // if this step walked you into a guard's view, sound the klaxon now
        // after any reaction fire, halt on a fresh contact; otherwise keep walking
        const proceed = () => {
          if (!unit.alive) return endMove();
          if (contacts.length) LS.render.contactMoment(unit, contacts, endMove);
          else { i++; stepOne(); }
        };
        if (reactors.length) resolveReactions(unit, reactors, proceed);
        else proceed();
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
      if (!LS.game.canSnap(r) || !LS.los.canSee(r, mover.x, mover.y)) return next();
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

  // --- drag to pan the camera (a plain click still selects/moves) ----------
  const DRAG_THRESHOLD = 5; // px before a press counts as a pan rather than a click
  function onDragStart(e) {
    if (e.button !== 0 || LS.state.busy || LS.state.over || LS.state.handoff) return;
    drag = { sx: e.clientX, sy: e.clientY, camX: LS.state.cam.x, camY: LS.state.cam.y, moved: false };
  }
  function onDragMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    svg.style.cursor = 'grabbing';
    const rect = svg.getBoundingClientRect(), { tile, view } = LS.config;
    // screen pixels -> world pixels; drag right => map slides right => camera moves left
    LS.render.setCamera(drag.camX - dx / rect.width * (view.cols * tile), drag.camY - dy / rect.height * (view.rows * tile));
  }
  function onDragEnd() {
    if (drag && drag.moved) suppressClick = true; // swallow the click that the browser fires next
    drag = null;
    if (svg) svg.style.cursor = '';
  }

  function onMove(e) {
    if (drag && drag.moved) return; // mid-drag: don't fight the pan with hover updates
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

  // a brief team-coloured "[TEAM] turn" sweep that auto-dismisses, then runs `done`
  function showTurnIntro(team, sub, done) {
    const ti = document.getElementById('turn-intro'), lbl = ti.querySelector('.ti-team');
    lbl.textContent = LS.util.teamName(team).toUpperCase();
    lbl.className = 'ti-team ' + team;
    ti.querySelector('.ti-sub').textContent = sub;
    ti.classList.remove('show'); void ti.offsetWidth; // restart the animation
    ti.classList.add('show');
    setTimeout(() => { ti.classList.remove('show'); if (done) done(); }, 1200);
  }

  // called after a turn ends: announce the handover, then hand to the AI, the next human,
  // or the pass-the-device screen
  function afterTurnChange() {
    if (LS.state.over) { LS.render.draw(); return; }
    const active = LS.state.activeTeam;
    if (LS.game.isAI(active)) {            // computer's turn: announce it, then play it
      LS.state.handoff = false;
      LS.game.resumeTurn();
      LS.state.busy = true;               // block input through the announcement and the AI's go
      LS.render.draw();
      showTurnIntro(active, "Computer's move", () => {
        LS.ai.takeTurn(() => {            // end the turn — detonating any grenades it cooked first
          const endAI = () => { LS.game.endTurn(); afterTurnChange(); };
          if (LS.state.liveGrenades.length) detonateLive(endAI); else endAI();
        });
      });
      return;
    }
    if (LS.config.aiTeams && LS.config.aiTeams.length) { // vs-computer, human's turn: announce, no device to pass
      LS.state.handoff = false;
      LS.game.resumeTurn();
      centerOnTeam(active);
      LS.render.draw();
      showTurnIntro(active, 'Your move', null);
      return;
    }
    // hot-seat: endTurn left handoff=true, so the (restyled) pass-the-device screen shows
    LS.render.draw();
  }

  // end turn — but guard against ending with soldiers who could still shoot (a misclick wastes the turn).
  // a first press warns; a second press within the window, or no ready soldiers, actually ends.
  function resetEndConfirm() {
    endConfirm = false; clearTimeout(endConfirmTimer);
    const b = document.getElementById('end-turn');
    if (b) { b.textContent = 'End turn ▸'; b.classList.remove('warn'); }
  }
  function doEndTurn() {
    resetEndConfirm();
    LS.sound.play('endturn');
    if (LS.state.liveGrenades.length) detonateLive(() => { LS.game.endTurn(); afterTurnChange(); });
    else { LS.game.endTurn(); afterTurnChange(); }
  }
  function tryEndTurn() {
    if (LS.state.busy || LS.state.over || LS.state.handoff) return;
    const ready = LS.game.teamUnits(LS.state.activeTeam).some(u => LS.game.canSnap(u));
    if (ready && !endConfirm) {
      endConfirm = true;
      const b = document.getElementById('end-turn');
      b.textContent = 'End anyway? ▸'; b.classList.add('warn');
      clearTimeout(endConfirmTimer); endConfirmTimer = setTimeout(resetEndConfirm, 3000);
      return;
    }
    doEndTurn();
  }

  function showStartScreen() {
    document.getElementById('start-screen').style.display = 'flex';
  }
  // begin a game in the chosen mode (aiTeams: [] = hot-seat, ['red'] = vs computer)
  function startGame(aiTeams) {
    LS.config.aiTeams = aiTeams;
    LS.game.newGame();
    LS.game.refreshReach();
    centerOnTeam('blue'); // frame the attacking squad
    LS.render.draw();
    document.getElementById('start-screen').style.display = 'none';
    if (aiTeams.length) showEquip(); // vs computer: arm your squad before deploying (hot-seat keeps defaults)
  }

  // --- equip phase: spend a credit budget kitting out your squad before the mission ---
  const clipCost = (wid) => Math.ceil(LS.weapons[wid].cost * 0.3);
  const GRENADE_COST = 6;
  function soldierCost(u) { return LS.weapons[u.weapon].cost + u.clips * clipCost(u.weapon) + u.grenades * GRENADE_COST; }
  function showEquip() { renderEquip(); document.getElementById('equip').style.display = 'flex'; }
  function renderEquip() {
    const blue = LS.game.teamUnits('blue'), budget = LS.level.budget || 280;
    let spent = 0;
    const rows = blue.map(u => {
      spent += soldierCost(u);
      const guns = Object.keys(LS.weapons).map(wid =>
        `<button class="eq-w${u.weapon === wid ? ' on' : ''}" data-eqw="${u.id}:${wid}">${LS.weapons[wid].name}<span>${LS.weapons[wid].cost}c</span></button>`).join('');
      return `<div class="equip-row">
        <span class="eq-name">${u.name}</span>
        <span class="eq-guns">${guns}</span>
        <span class="eq-step">clips <button data-eqc="${u.id}:-1">−</button><b>${u.clips}</b><button data-eqc="${u.id}:1">+</button></span>
        <span class="eq-step">nades <button data-eqn="${u.id}:-1">−</button><b>${u.grenades}</b><button data-eqn="${u.id}:1">+</button></span>
        <span class="eq-cost">${soldierCost(u)}c</span>
      </div>`;
    }).join('');
    document.getElementById('equip-rows').innerHTML = rows;
    const left = budget - spent;
    const cr = document.getElementById('equip-credits');
    cr.textContent = `Credits ${left} / ${budget}`;
    cr.classList.toggle('over', left < 0);
    document.getElementById('equip-deploy').disabled = left < 0;
  }
  function setWeapon(u, wid) { u.weapon = wid; u.ammo = LS.weapons[wid].clip; } // a new gun comes with a full clip
  function recommendedLoadout() {
    LS.game.teamUnits('blue').forEach(u => { setWeapon(u, 'laser'); u.clips = 1; u.grenades = 2; });
  }
  function deploy() {
    document.getElementById('equip').style.display = 'none';
    LS.game.refreshReach();
    LS.render.draw();
  }

  function init() {
    svg = document.getElementById('board');
    svg.addEventListener('click', onClick);
    svg.addEventListener('mousemove', onMove);
    svg.addEventListener('mousedown', onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    svg.addEventListener('mouseleave', () => { if (!drag) { hoverDir = -1; LS.render.drawFacing(-1); LS.render.drawHover(null, null); } });
    document.getElementById('end-turn').addEventListener('click', tryEndTurn);
    document.addEventListener('keydown', (e) => {
      const hm = document.getElementById('howto');
      if (e.key === 'Escape') {                       // close modal > cancel throw > deselect
        if (hm.style.display !== 'none') { hm.style.display = 'none'; return; }
        if (LS.state.throwMode) { LS.state.throwMode = null; LS.render.draw(); return; }
        if (LS.game.selected()) { LS.game.selectUnit(null); LS.render.draw(); return; }
        return;
      }
      if (hm.style.display !== 'none') return;         // modal open: swallow game keys
      if (document.getElementById('equip').style.display === 'flex') return; // arming the squad: keys off
      const T = LS.config.tile;
      const pan = { ArrowLeft: [-T, 0], a: [-T, 0], ArrowRight: [T, 0], d: [T, 0], ArrowUp: [0, -T], w: [0, -T], ArrowDown: [0, T], s: [0, T] }[e.key];
      if (pan) { LS.render.panBy(pan[0], pan[1]); e.preventDefault(); return; }
      // the rest are your-turn shortcuts
      if (LS.state.busy || LS.state.over || LS.state.handoff || LS.game.isAI(LS.state.activeTeam)) return;
      if (e.key === 'e' || e.key === 'E') { tryEndTurn(); e.preventDefault(); return; }
      if (e.key >= '1' && e.key <= '9') {              // select the Nth soldier of your squad
        const u = LS.game.teamUnits(LS.state.activeTeam)[+e.key - 1];
        if (u) { LS.game.selectUnit(u.id); LS.render.followUnit(u, true); LS.render.draw(); }
        return;
      }
      if (e.key === 'g' || e.key === 'G') {            // toggle the selected soldier's grenade aim
        const sel = LS.game.selected();
        if (sel && sel.team === LS.state.activeTeam && sel.grenades > 0 && sel.ap >= LS.config.grenade.throwCost) {
          LS.state.throwMode = LS.state.throwMode === sel.id ? null : sel.id;
          LS.render.draw();
        }
        return;
      }
      if (e.key === 'f' || e.key === 'F') {            // toggle aimed / snap fire
        LS.state.fireMode = LS.state.fireMode === 'aimed' ? 'snap' : 'aimed';
        LS.render.draw();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {            // reload the selected soldier
        const sel = LS.game.selected();
        if (sel && sel.team === LS.state.activeTeam) {
          const res = LS.game.reload(sel);
          if (!res.ok && res.reason) LS.game.log(res.reason);
          else if (res.ok) LS.sound.play('door');
          LS.render.draw();
        }
        return;
      }
    });
    // click a soldier's card to select it, or its grenade button to aim a throw
    document.querySelector('.rosters').addEventListener('click', (e) => {
      if (LS.state.busy || LS.state.over || LS.state.handoff) return;
      const fb = e.target.closest('.sc-fire');           // toggle aimed / snap fire
      if (fb) { LS.state.fireMode = LS.state.fireMode === 'aimed' ? 'snap' : 'aimed'; LS.render.draw(); return; }
      const tb = e.target.closest('.sc-throw');
      if (tb) {
        const u = LS.game.unitById(tb.dataset.throw);
        if (u && u.alive && u.team === LS.state.activeTeam) {
          const wasArming = LS.state.throwMode === u.id;
          LS.game.selectUnit(u.id);                      // note: selectUnit() clears throwMode
          LS.state.throwMode = wasArming ? null : u.id;  // so toggle off the *prior* state
          LS.render.followUnit(u, true);
          LS.render.draw();
        }
        return;
      }
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const u = LS.game.unitById(card.dataset.id);
      if (u && u.alive && u.team === LS.state.activeTeam) {
        LS.game.selectUnit(u.id);
        LS.render.followUnit(u, true);   // glide to it (it may be off-screen) rather than jump
        LS.render.draw();
      }
    });
    // keyboard: Enter/Space on a focused squad card selects it (the grenade button is a native button)
    document.querySelector('.rosters').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.squad-card[data-id]');
      if (card) { e.preventDefault(); card.click(); }
    });
    document.getElementById('restart').addEventListener('click', showStartScreen); // back to the menu to re-pick a mode
    document.getElementById('start-hotseat').addEventListener('click', () => { LS.sound.ensure(); startGame([]); });
    document.getElementById('start-ai').addEventListener('click', () => { LS.sound.ensure(); startGame(['red']); });
    // equip screen: change a soldier's gun, clips and grenades within budget
    document.getElementById('equip-rows').addEventListener('click', (e) => {
      const w = e.target.closest('[data-eqw]'), c = e.target.closest('[data-eqc]'), n = e.target.closest('[data-eqn]');
      if (w) { const [id, wid] = w.dataset.eqw.split(':'); setWeapon(LS.game.unitById(id), wid); }
      else if (c) { const [id, d] = c.dataset.eqc.split(':'); const u = LS.game.unitById(id); u.clips = LS.util.clamp(u.clips + (+d), 0, 5); }
      else if (n) { const [id, d] = n.dataset.eqn.split(':'); const u = LS.game.unitById(id); u.grenades = LS.util.clamp(u.grenades + (+d), 0, 5); }
      else return;
      renderEquip();
    });
    document.getElementById('equip-quick').addEventListener('click', () => { recommendedLoadout(); deploy(); });
    document.getElementById('equip-deploy').addEventListener('click', deploy);
    const howto = document.getElementById('howto');
    document.getElementById('howto-btn').addEventListener('click', () => { howto.style.display = 'flex'; });
    document.getElementById('howto-close').addEventListener('click', () => { howto.style.display = 'none'; });
    howto.addEventListener('click', (e) => { if (e.target === howto) howto.style.display = 'none'; }); // click the backdrop to close
    document.getElementById('handoff-btn').addEventListener('click', () => {
      LS.game.resumeTurn();
      centerOnTeam(LS.state.activeTeam); // frame the squad whose turn it now is
      LS.render.draw();
    });
    document.getElementById('mute').addEventListener('click', () => {
      LS.sound.toggle();
      LS.ui.update();
    });
    const watchBtn = document.getElementById('watch-ai');
    if (watchBtn) watchBtn.addEventListener('click', () => {
      LS.config.debug.watchAI = !LS.config.debug.watchAI;
      LS.ui.update();
    });
  }

  return { init, showStartScreen };
})();
