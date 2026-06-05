// ai.js — the computer opponent. It plays fog-fairly: it decides only on what its own
// soldiers can see, and the human watches only the parts their squad can see (a red unit
// moving through the dark resolves instantly off-camera; it pops into view, with the
// contact alert, the moment it crosses into your sight or fires at you).
LS.ai = (function () {
  const W = () => LS.level.weapon;
  const cfg = () => LS.config;

  // --- the brain: pure decisions, no animation -----------------------------
  function enemiesSeen(u) {
    return LS.state.units.filter(e => e.alive && e.team !== u.team && LS.los.canSee(u, e.x, e.y));
  }
  function shootable(u) {
    return enemiesSeen(u).filter(e => LS.los.canTarget(u, e.x, e.y));
  }
  // value of shooting a target: expected damage, with a nudge to finish the wounded
  function shotValue(u, t) {
    const p = LS.game.hitChance(u, t.x, t.y);
    let v = p * (W().dmgMin + W().dmgMax) / 2;       // expected damage
    if (p >= 0.5 && t.hp <= W().dmgMax) v += 4;        // can likely finish them off
    v += (t.maxHp - t.hp) * 0.25;                      // prefer the already-hurt
    return v;
  }
  function bestTarget(u) {
    const ts = shootable(u);
    return ts.length ? ts.sort((a, b) => shotValue(u, b) - shotValue(u, a))[0] : null;
  }
  function nearest(u, list) {
    return list.slice().sort((a, b) => LS.los.dist(u.x, u.y, a.x, a.y) - LS.los.dist(u.x, u.y, b.x, b.y))[0];
  }
  // best reachable tile to engage `goal`: a tile we can shoot from (AP to spare) beats one that is
  // merely closer; ending next to cover is a tie-breaker
  function engageTile(u, goal) {
    const reach = LS.game.computeReachable(u), cols = cfg().cols, w = W();
    let best = null, score = -Infinity;
    reach.cost.forEach((ap, k) => {
      const x = k % cols, y = Math.floor(k / cols);
      if (x === u.x && y === u.y) return;
      const apLeft = u.ap - ap;
      const canShoot = LS.los.dist(x, y, goal.x, goal.y) <= w.range
        && LS.los.lineClear(x, y, goal.x, goal.y, LS.los.blocksShot) && apLeft >= w.fireCost;
      const d = LS.DIRS[LS.util.nearestDir(goal.x - x, goal.y - y)];
      const inCover = LS.los.givesCover(x + d.dx, y + d.dy);
      let s = -LS.los.dist(x, y, goal.x, goal.y);      // closer is better
      if (canShoot) s += 100;                          // but a firing position is far better
      if (inCover) s += 3;
      if (s > score) { score = s; best = { x, y }; }
    });
    return best;
  }
  // an intact window that is the thing blocking our shot at e (so shattering it opens a firing line)
  function glassBlocking(u, e) {
    const b = LS.los.firstShotBlocker(u.x, u.y, e.x, e.y);
    if (b && LS.los.isWindow(b.x, b.y) && !LS.los.windowSmashed(b.x, b.y) && LS.los.dist(u.x, u.y, b.x, b.y) <= W().range) return b;
    return null;
  }
  // an adjacent closed door whose far side is passable and lies toward the enemy (worth opening to sally/advance)
  function doorToward(u, goal) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const dox = u.x + dx, doy = u.y + dy;
      if (!LS.los.isDoor(dox, doy) || LS.los.doorOpen(dox, doy)) continue;
      const fx = dox + dx, fy = doy + dy; // the tile beyond the door
      if (LS.los.blocksMove(fx, fy) || LS.game.unitAt(fx, fy)) continue;
      if (LS.los.dist(fx, fy, goal.x, goal.y) < LS.los.dist(u.x, u.y, goal.x, goal.y)) return { x: dox, y: doy };
    }
    return null;
  }
  // best grenade throw: aim at a visible enemy or just off them; value = enemies caught in the blast.
  // never throws if a friendly is in the blast (it detonates at end of turn, so check current spots).
  function bestGrenade(u) {
    if (u.grenades <= 0 || u.ap < cfg().grenade.throwCost) return null;
    const enemies = enemiesSeen(u);
    if (!enemies.length) return null;
    // enemies already under a grenade cooked this turn — don't waste a second one stacking on them
    const pending = new Set();
    LS.state.liveGrenades.forEach(g => LS.game.blastTiles(g.x, g.y).forEach(t => pending.add(t.x + ',' + t.y)));
    const cands = new Set();
    enemies.forEach(e => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
        if (LS.game.canThrowTo(u, e.x + dx, e.y + dy)) cands.add((e.x + dx) + ',' + (e.y + dy));
    });
    let best = null;
    cands.forEach(s => {
      const [x, y] = s.split(',').map(Number);
      const tset = new Set(LS.game.blastTiles(x, y).map(t => t.x + ',' + t.y));
      let blue = 0, friendly = 0;
      LS.state.units.forEach(z => {
        if (!z.alive || !tset.has(z.x + ',' + z.y)) return;
        if (z.team === u.team) friendly++;
        else if (!pending.has(z.x + ',' + z.y)) blue++; // only count enemies not already being grenaded
      });
      if (friendly > 0 || blue === 0) return; // never friendly-fire; must catch a fresh target
      if (!best || blue > best.blue) best = { x, y, blue };
    });
    return best;
  }
  // could a known enemy land a shot on this tile (ignoring their facing — they can turn)?
  function threatenedAt(u, x, y) { return enemiesSeen(u).some(e => LS.los.canTarget(e, x, y)); }
  // a reachable tile that gets out of the line of fire, preferring distance from the enemies we can see
  function retreatTile(u) {
    const reach = LS.game.computeReachable(u), cols = cfg().cols, threats = enemiesSeen(u);
    let best = null, score = -Infinity;
    reach.cost.forEach((ap, k) => {
      const x = k % cols, y = Math.floor(k / cols);
      let s = threatenedAt(u, x, y) ? 0 : 50;                  // safety is the big prize
      s += threats.length ? Math.min(...threats.map(e => LS.los.dist(x, y, e.x, e.y))) : 0; // and put ground between us
      if (s > score) { score = s; best = { x, y }; }
    });
    return best;
  }

  // one action: big grenade > break contact when hurt > shoot > grenade a target we can't shoot >
  // clear glass > reposition > open a door > hold
  function decide(u) {
    const t = bestTarget(u);
    const nade = bestGrenade(u);
    if (nade && nade.blue >= 2) return { type: 'throw', at: nade }; // a grenade that catches two+ is too good to skip
    const hurt = u.hp <= Math.max(3, Math.ceil(u.maxHp * 0.3));
    if (hurt && u.ap >= cfg().ap.moveOrtho && threatenedAt(u, u.x, u.y)) {
      const killShot = t && LS.game.hitChance(u, t.x, t.y) >= 0.5 && t.hp <= W().dmgMax;
      if (!killShot) {                                          // badly hurt and exposed: fall back, unless a kill is right there
        const safe = retreatTile(u);
        if (safe && (safe.x !== u.x || safe.y !== u.y)) return { type: 'move', dest: safe };
      }
    }
    if (t) return u.ap >= W().fireCost ? { type: 'fire', target: t } : { type: 'end' };
    if (nade && nade.blue >= 1) return { type: 'throw', at: nade }; // can't shoot them — flush them out with a grenade
    const seen = enemiesSeen(u);
    if (!seen.length) return { type: 'end' };
    const goal = nearest(u, seen);
    const glass = glassBlocking(u, goal);
    if (glass && u.ap >= W().fireCost) return { type: 'shootWindow', at: glass };
    if (u.ap >= cfg().ap.moveOrtho) {
      const dest = engageTile(u, goal);
      if (dest && (dest.x !== u.x || dest.y !== u.y)) return { type: 'move', dest };
      const door = doorToward(u, goal); // boxed in: open a door that leads toward the enemy
      if (door && u.ap >= cfg().ap.door) return { type: 'openDoor', at: door };
    }
    return { type: 'end' };
  }

  // --- the hands: execute a turn, fog-fairly -------------------------------
  const seenByHuman = (x, y) => LS.game.teamVision(LS.game.viewTeam()).has(LS.game.key(x, y));
  const delay = (ms, fn) => setTimeout(fn, LS.config.anim.enabled ? ms : 0);

  // the human's soldiers overwatching an advancing AI unit get their reaction shot
  function resolveReactions(mover, reactors, done) {
    let j = 0;
    (function next() {
      if (j >= reactors.length || !mover.alive || LS.state.over) return done();
      const r = reactors[j++];
      if (r.ap < W().fireCost || !LS.los.canSee(r, mover.x, mover.y)) return next();
      const res = LS.game.fire(r, mover, { reaction: true });
      LS.render.shotFx(r, mover, res, () => { LS.render.draw(); delay(180, next); });
    })();
  }

  function aiFire(shooter, target, done) {
    const res = LS.game.fire(shooter, target);
    if (!res.ok) return done();
    LS.render.reveal(shooter.id); // firing gives your position away — show the shooter for the shot
    LS.render.focusTile(shooter.x, shooter.y, () => { // make sure the shot is on screen
      LS.render.draw();
      LS.render.shotFx(shooter, target, res, () => {
        LS.render.unreveal(shooter.id);
        LS.render.draw();
        delay(160, done);
      });
    });
  }

  function aiThrow(unit, at, done) {
    const res = LS.game.throwGrenade(unit, at.x, at.y);
    if (!res.ok) return done();
    LS.render.reveal(unit.id); // throwing gives your position away too
    LS.render.focusTile(at.x, at.y, () => { // show where it lands (it is near your soldiers, so on screen)
      LS.render.draw();
      LS.render.throwArc(unit, { x: at.x, y: at.y }, () => {
        LS.render.unreveal(unit.id);
        LS.render.draw();
        delay(180, done);
      });
    });
  }

  function aiShootGlass(unit, at, done) {
    const res = LS.game.shootWindow(unit, at.x, at.y);
    if (!res.ok) return done();
    LS.render.reveal(unit.id);
    LS.render.focusTile(unit.x, unit.y, () => {
      LS.render.draw();
      LS.render.shotFx(unit, { x: at.x, y: at.y }, { ok: true, hit: true, glass: true }, () => {
        LS.render.unreveal(unit.id);
        LS.render.draw();
        delay(160, done);
      });
    });
  }

  function aiOpenDoor(unit, at, done) {
    const res = LS.game.toggleDoor(unit, at.x, at.y);
    if (!res.ok) return done();
    if (seenByHuman(unit.x, unit.y) || seenByHuman(at.x, at.y)) { // only seen/heard if you can see it
      LS.sound.play('door');
      LS.render.reveal(unit.id);
      LS.render.focusTile(unit.x, unit.y, () => {
        LS.render.draw();
        delay(240, () => { LS.render.unreveal(unit.id); LS.render.draw(); done(); });
      });
    } else {
      LS.render.draw();
      done();
    }
  }

  function aiMove(unit, path, done) {
    let i = 1, wasVisible = seenByHuman(unit.x, unit.y);
    function step() {
      if (i >= path.length || !unit.alive || LS.state.over) return done();
      const from = path[i - 1], to = path[i];
      unit.facing = LS.util.dirIndex(to.x - from.x, to.y - from.y);
      const finishStep = () => {
        LS.game.applyStep(unit, from, to); // moves, spends AP, updates both teams' vision
        const reactors = LS.game.findReactors(unit); // human overwatch on the advancing AI unit
        const after = () => {
          if (!unit.alive || LS.state.over) { LS.render.draw(); return done(); }
          const visNow = seenByHuman(unit.x, unit.y);
          if (visNow && !wasVisible) {            // just stepped into the human's sight
            wasVisible = true;
            LS.render.contactMoment(unit, [unit], () => { i++; step(); }); // alert + reveal + carry on
            return;
          }
          wasVisible = visNow;
          LS.render.draw();
          if (visNow) LS.render.followUnit(unit); // track it while it stays in view
          i++; step();
        };
        if (reactors.length) { LS.render.draw(); resolveReactions(unit, reactors, after); }
        else after();
      };
      if (wasVisible) { // visible to the human: glide it so they can watch
        LS.render.followUnit(unit);
        LS.render.animateStep(unit, from, to, finishStep);
      } else {
        finishStep(); // off in the dark: resolve instantly, no camera move
      }
    }
    step();
  }

  function actUnit(u, done) {
    if (!u.alive || LS.state.over) return done();
    const apBefore = u.ap;
    const cont = () => { // only loop if the unit actually spent AP (no infinite loops)
      if (!u.alive || LS.state.over || u.ap >= apBefore || u.ap <= 0) return done();
      actUnit(u, done);
    };
    const action = decide(u);
    if (action.type === 'fire') return aiFire(u, action.target, cont);
    if (action.type === 'throw') return aiThrow(u, action.at, cont);
    if (action.type === 'shootWindow') return aiShootGlass(u, action.at, cont);
    if (action.type === 'openDoor') return aiOpenDoor(u, action.at, cont);
    if (action.type === 'move') {
      const reach = LS.game.computeReachable(u);
      const path = LS.game.pathTo(reach, action.dest.x, action.dest.y);
      if (!path || path.length < 2) return done();
      return aiMove(u, path, cont);
    }
    done();
  }

  // play the whole turn for the active (AI) team, then call onDone
  function takeTurn(onDone) {
    LS.game.selectUnit(null); // the human isn't selecting anything during the AI turn
    LS.state.busy = true;
    LS.ui.update();
    const units = LS.game.teamUnits(LS.state.activeTeam).slice();
    let idx = 0;
    function nextUnit() {
      if (LS.state.over || idx >= units.length) { LS.state.busy = false; return onDone && onDone(); }
      const u = units[idx++];
      if (!u.alive) return nextUnit();
      actUnit(u, () => delay(160, nextUnit));
    }
    delay(350, nextUnit); // a beat so the human registers the turn change
  }

  return { takeTurn, decide, bestTarget, engageTile };
})();
