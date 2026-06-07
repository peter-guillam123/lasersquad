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

  // ALERT, nothing in sight: converge on where we last knew the player to be (their fading
  // "?" ghost) — or, if a shot rang out with no sighting, on the noise. This is the fix for
  // "they forget": last-seen memory already exists, the brain just wasn't using it.
  function huntGoal(u) {
    const know = LS.state.knowledge.red, ids = Object.keys(know);
    let best = null, bestD = Infinity;
    ids.forEach(id => { const k = know[id]; const d = LS.los.dist(u.x, u.y, k.x, k.y); if (d < bestD) { bestD = d; best = k; } });
    return best || LS.game.alertInfo('red').focus || null;
  }
  // the reachable tile that gets us strictly CLOSER to a goal we can't see (pure pursuit).
  // requiring genuine progress is what stops the old ping-pong between two equidistant tiles.
  function stepToward(u, goal) {
    const reach = LS.game.computeReachable(u), cols = cfg().cols;
    let best = null, bestD = LS.los.dist(u.x, u.y, goal.x, goal.y); // must beat where we already stand
    reach.cost.forEach((ap, k) => {
      const x = k % cols, y = Math.floor(k / cols);
      const d = LS.los.dist(x, y, goal.x, goal.y);
      if (d < bestD) { bestD = d; best = { x, y }; }
    });
    return best;
  }
  // a door-permeable route to the goal: BFS where a CLOSED door counts as passable (we'll open it
  // on the way). Returns the tile path toward the goal, or toward the nearest tile we could reach.
  function navPath(u, goal) {
    const cols = cfg().cols, rows = cfg().rows, K = (x, y) => y * cols + x;
    const prev = new Map(), seen = new Set([K(u.x, u.y)]), q = [{ x: u.x, y: u.y }];
    const CARD = [LS.DIRS[0], LS.DIRS[2], LS.DIRS[4], LS.DIRS[6]]; // N,E,S,W (doors sit on cardinal walls)
    let best = { x: u.x, y: u.y }, bestD = LS.los.dist(u.x, u.y, goal.x, goal.y);
    while (q.length) {
      const cur = q.shift();
      if (cur.x === goal.x && cur.y === goal.y) { best = cur; break; }
      const d0 = LS.los.dist(cur.x, cur.y, goal.x, goal.y);
      if (d0 < bestD) { bestD = d0; best = cur; }
      for (const nd of CARD) {
        const nx = cur.x + nd.dx, ny = cur.y + nd.dy, nk = K(nx, ny);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(nk)) continue;
        if (!LS.los.isDoor(nx, ny)) {              // a door is always traversable for planning
          if (LS.los.blocksMove(nx, ny)) continue; // wall / window / intact breakable
          const occ = LS.game.unitAt(nx, ny);
          if (occ && occ.id !== u.id && !(nx === goal.x && ny === goal.y)) continue;
        }
        seen.add(nk); prev.set(nk, K(cur.x, cur.y)); q.push({ x: nx, y: ny });
      }
    }
    const path = []; let ck = K(best.x, best.y);
    while (ck !== undefined) { path.unshift({ x: ck % cols, y: Math.floor(ck / cols) }); ck = prev.get(ck); }
    return path;
  }
  // one navigation action toward a goal, opening doors as needed (the heart of hunting AND patrol):
  // head for the first closed door on the route and open it, otherwise just advance toward the goal.
  function navStep(u, goal) {
    if (!goal) return { type: 'end' };
    const path = navPath(u, goal);
    let di = -1;
    for (let i = 1; i < path.length; i++) {
      const p = path[i];
      if (LS.los.isDoor(p.x, p.y) && !LS.los.doorOpen(p.x, p.y)) { di = i; break; }
    }
    if (di !== -1) {
      const door = path[di];
      if (Math.abs(u.x - door.x) + Math.abs(u.y - door.y) === 1) { // standing next to it — open it
        return u.ap >= cfg().ap.door ? { type: 'openDoor', at: door } : { type: 'end' };
      }
      const approach = path[di - 1]; // the open tile just before the door
      const reach = LS.game.computeReachable(u);
      if (reach.cost.has(reach.key(approach.x, approach.y))) return { type: 'move', dest: approach, reason: 'hunt' };
      const near = stepToward(u, approach);
      return near ? { type: 'move', dest: near, reason: 'hunt' } : { type: 'end' };
    }
    const dest = stepToward(u, goal); // open route — just close the distance
    return dest ? { type: 'move', dest, reason: 'hunt' } : { type: 'end' };
  }
  function huntDecision(u) {
    if (u.ap < cfg().ap.moveOrtho) return { type: 'end' };
    const goal = huntGoal(u);
    return goal ? navStep(u, goal) : { type: 'end' };
  }
  // CALM: the guard routine. Most guards hold station — scanning their arc and shuffling a tile
  // or two around their post; one or two designated patrollers walk a beat between two points.
  // One action per guard per turn (no pacing the whole AP away), so the calm turn feels alive
  // without descending into a fidget. A patroller that strays into your sight trips the alert.
  function scanDir(u) { return (u.facing + (LS.util.randInt(0, 1) ? 1 : 7)) % 8; } // glance one notch L/R
  function shuffleStep(u, post) { // a legal one-step move that keeps us within two tiles of home
    const reach = LS.game.computeReachable(u), cols = cfg().cols, opts = [];
    reach.cost.forEach((ap, k) => {
      if (ap > cfg().ap.moveDiag) return; // a single step only
      const x = k % cols, y = Math.floor(k / cols);
      if (x === u.x && y === u.y) return;
      if (Math.max(Math.abs(x - post.x), Math.abs(y - post.y)) > 2) return;
      opts.push({ x, y });
    });
    return opts.length ? opts[LS.util.randInt(0, opts.length - 1)] : null;
  }
  function computeBeat(post) { // the longest clear cardinal run from the post (up to 5 tiles)
    let best = null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let len = 0;
      for (let s = 1; s <= 5; s++) {
        const x = post.x + dx * s, y = post.y + dy * s;
        if (x < 0 || y < 0 || x >= cfg().cols || y >= cfg().rows || LS.los.blocksMove(x, y)) break;
        len = s;
      }
      if (len >= 2 && (!best || len > best.len)) best = { dx, dy, len, out: true };
    }
    return best;
  }
  function beatStep(u, post) { // walk a few tiles toward the current end of the beat; reverse at the ends
    if (u.beat === undefined) u.beat = computeBeat(post) || null;
    if (!u.beat) return null;
    const b = u.beat;
    const target = b.out ? { x: post.x + b.dx * b.len, y: post.y + b.dy * b.len } : { x: post.x, y: post.y };
    if (LS.los.dist(u.x, u.y, target.x, target.y) <= 1) { b.out = !b.out; return null; } // arrived — pause and scan
    const reach = LS.game.computeReachable(u), path = LS.game.pathTo(reach, target.x, target.y);
    if (path && path.length >= 2) return path[Math.min(3, path.length - 1)];
    return stepToward(u, target);
  }
  function patrolDecision(u) {
    if (u._pacedTurn === LS.state.turnCount) return { type: 'end' }; // already had a patrol action this turn
    u._pacedTurn = LS.state.turnCount;
    const post = u.post || { x: u.x, y: u.y };
    if (u.patrol) {
      const dest = beatStep(u, post);
      if (dest && (dest.x !== u.x || dest.y !== u.y)) return { type: 'move', dest, reason: 'patrol' };
    } else if (LS.util.randInt(1, 100) <= 35) { // a stationary guard occasionally shifts his weight
      const dest = shuffleStep(u, post);
      if (dest) return { type: 'move', dest, reason: 'patrol' };
    }
    return { type: 'face', dir: scanDir(u) }; // otherwise just look around (costs no AP, ends the go)
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
        if (safe && (safe.x !== u.x || safe.y !== u.y)) return { type: 'move', dest: safe, reason: 'retreat' };
      }
    }
    if (t) return u.ap >= W().fireCost ? { type: 'fire', target: t } : { type: 'end' };
    if (nade && nade.blue >= 1) return { type: 'throw', at: nade }; // can't shoot them — flush them out with a grenade
    const seen = enemiesSeen(u);
    if (!seen.length) { // nothing in sight: hunt the last-known position, or patrol
      const lvl = LS.game.alertLevel(u.team);
      if (lvl === 'alert') return huntDecision(u);                                  // whole squad hunts
      const info = LS.game.alertInfo(u.team);
      if (lvl === 'investigating' && info && info.investigator === u.id) return huntDecision(u); // lone investigator
      return patrolDecision(u);                                                     // everyone else carries on
    }
    const goal = nearest(u, seen);
    const glass = glassBlocking(u, goal);
    if (glass && u.ap >= W().fireCost) return { type: 'shootWindow', at: glass };
    if (u.ap >= cfg().ap.moveOrtho) {
      const dest = engageTile(u, goal);
      if (dest && (dest.x !== u.x || dest.y !== u.y)) return { type: 'move', dest, reason: 'engage' };
      const door = doorToward(u, goal); // boxed in: open a door that leads toward the enemy
      if (door && u.ap >= cfg().ap.door) return { type: 'openDoor', at: door };
    }
    return { type: 'end' };
  }

  // a short human-readable caption for the debug "watch AI" mode
  function describe(u, action) {
    const alert = LS.game.alertLevel(u.team) === 'alert';
    switch (action.type) {
      case 'fire':        return { text: `firing at ${action.target.name}`, color: '#ff5d5d' };
      case 'throw':       return { text: 'grenade out', color: '#ff9a3c' };
      case 'shootWindow': return { text: 'clearing a window', color: '#5fbcc6' };
      case 'openDoor':    return { text: 'opening a door', color: '#c8a23c' };
      case 'face':        return { text: 'scanning', color: '#9a946f' };
      case 'move':
        if (action.reason === 'retreat') return { text: 'falling back', color: '#5fbcc6' };
        if (action.reason === 'hunt')    return { text: 'closing on last sighting', color: '#e6ad33' };
        if (action.reason === 'patrol')  return { text: 'on patrol', color: '#9a946f' };
        return { text: 'advancing', color: '#e6ad33' };
      default: // 'end' / hold
        if (alert) return { text: 'lost contact — searching', color: '#e6ad33' };
        return enemiesSeen(u).length ? { text: 'holding', color: '#9a946f' } : { text: 'on guard', color: '#9a946f' };
    }
  }

  // --- the hands: execute a turn, fog-fairly -------------------------------
  const seenByHuman = (x, y) => LS.game.teamVision(LS.game.viewTeam()).has(LS.game.key(x, y));
  const watching = () => LS.render.isWatching();
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
    if (seenByHuman(unit.x, unit.y) || seenByHuman(at.x, at.y) || watching()) { // only seen/heard if you can see it
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
          if (visNow || watching()) LS.render.followUnit(unit); // track it while it stays in view
          i++; step();
        };
        if (reactors.length) { LS.render.draw(); resolveReactions(unit, reactors, after); }
        else after();
      };
      if (wasVisible || watching()) { // visible to the human (or we're watching the AI): glide it so they can watch
        LS.render.followUnit(unit);
        LS.render.animateStep(unit, from, to, finishStep);
      } else if (LS.config.anim.enabled) {
        // off in the dark: no visuals, but pace a footfall so you hear the enemy on the move
        LS.sound.play('step');
        setTimeout(finishStep, 130);
      } else {
        finishStep();
      }
    }
    step();
  }

  function aiFace(unit, dir, done) { // a scan: turn on the spot, no AP — so the unit's go ends after it
    if (typeof dir === 'number' && dir >= 0) unit.facing = dir;
    LS.render.draw();
    delay(120, done);
  }

  function actUnit(u, done) {
    if (!u.alive || LS.state.over) return done();
    const apBefore = u.ap;
    const cont = () => { // only loop if the unit actually spent AP (no infinite loops)
      if (!u.alive || LS.state.over || u.ap >= apBefore || u.ap <= 0) return done();
      actUnit(u, done);
    };
    const action = decide(u);
    const run = () => {
      if (action.type === 'fire') return aiFire(u, action.target, cont);
      if (action.type === 'throw') return aiThrow(u, action.at, cont);
      if (action.type === 'shootWindow') return aiShootGlass(u, action.at, cont);
      if (action.type === 'openDoor') return aiOpenDoor(u, action.at, cont);
      if (action.type === 'face') return aiFace(u, action.dir, cont);
      if (action.type === 'move') {
        const reach = LS.game.computeReachable(u);
        const path = LS.game.pathTo(reach, action.dest.x, action.dest.y);
        if (!path || path.length < 2) return done();
        return aiMove(u, path, cont);
      }
      done();
    };
    if (watching()) { // pan to the unit, caption what it's about to do, hold a beat so you can read it
      const cap = describe(u, action);
      LS.render.focusTile(u.x, u.y, () => { LS.render.setAiLabel(u, cap.text, cap.color); delay(620, run); });
    } else run();
  }

  // play the whole turn for the active (AI) team, then call onDone
  function takeTurn(onDone) {
    LS.game.selectUnit(null); // the human isn't selecting anything during the AI turn
    LS.state.busy = true;
    LS.render.setWatchAll(!!(LS.config.debug && LS.config.debug.watchAI)); // debug: lift the fog for the turn
    if (LS.render.isWatching()) LS.render.draw(); // paint the fog-lifted board before the first action
    LS.ui.update();
    const units = LS.game.teamUnits(LS.state.activeTeam).slice();
    let idx = 0;
    const finish = () => { LS.render.setWatchAll(false); LS.render.draw(); LS.state.busy = false; onDone && onDone(); };
    function nextUnit() {
      if (LS.state.over || idx >= units.length) return finish();
      const u = units[idx++];
      if (!u.alive) return nextUnit();
      actUnit(u, () => delay(160, nextUnit));
    }
    delay(350, nextUnit); // a beat so the human registers the turn change
  }

  return { takeTurn, decide, bestTarget, engageTile };
})();
