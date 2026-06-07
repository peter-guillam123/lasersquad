// ai.js — the computer opponent. It plays fog-fairly: it decides only on what its own
// soldiers can see, and the human watches only the parts their squad can see (a red unit
// moving through the dark resolves instantly off-camera; it pops into view, with the
// contact alert, the moment it crosses into your sight or fires at you).
LS.ai = (function () {
  const W = (u) => LS.game.weaponOf(u); // this unit's gun (per-soldier now)
  const cfg = () => LS.config;

  // --- the brain: pure decisions, no animation -----------------------------
  function enemiesSeen(u) {
    return LS.state.units.filter(e => e.alive && e.team !== u.team && LS.los.canSee(u, e.x, e.y));
  }
  function shootable(u) { // enemies we can actually put a round into now (range, line of sight, ammo)
    return enemiesSeen(u).filter(e => LS.game.canFire(u, e.x, e.y));
  }
  // value of shooting a target: expected damage (aimed), with a nudge to finish the wounded
  function shotValue(u, t) {
    const w = W(u), p = LS.game.hitChance(u, t.x, t.y, 'aimed');
    let v = p * (w.dmgMin + w.dmgMax) / 2;             // expected damage
    if (p >= 0.5 && t.hp <= w.dmgMax) v += 4;          // can likely finish them off
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
    const reach = LS.game.computeReachable(u), cols = cfg().cols, w = W(u);
    let best = null, score = -Infinity;
    reach.cost.forEach((ap, k) => {
      const x = k % cols, y = Math.floor(k / cols);
      if (x === u.x && y === u.y) return;
      const apLeft = u.ap - ap;
      const canShoot = LS.los.dist(x, y, goal.x, goal.y) <= w.range
        && LS.los.lineClear(x, y, goal.x, goal.y, LS.los.blocksShot) && apLeft >= w.modes.snap.ap;
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
    if (b && LS.los.isWindow(b.x, b.y) && !LS.los.windowSmashed(b.x, b.y) && LS.los.dist(u.x, u.y, b.x, b.y) <= W(u).range) return b;
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
  function navStep(u, goal, reason) {
    reason = reason || 'hunt';
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
      if (reach.cost.has(reach.key(approach.x, approach.y))) return { type: 'move', dest: approach, reason };
      const near = stepToward(u, approach);
      return near ? { type: 'move', dest: near, reason } : { type: 'end' };
    }
    const dest = stepToward(u, goal); // open route — just close the distance
    return dest ? { type: 'move', dest, reason } : { type: 'end' };
  }
  // a chokepoint worth holding overwatch on toward the threat — but only one we're genuinely NEAR,
  // so distant guards advance to a forward position first rather than camping from the back. The
  // threat tile itself if it's close and in clean view (an open approach), else a nearby DOOR on the
  // route to it that we can already cover. null = nothing close to hold (so we should advance).
  function chokepointToward(u, threat) {
    const DOOR_HOLD = 4, OPEN_HOLD = 6; // how close a chokepoint / open approach must be to hold it
    if (LS.los.dist(u.x, u.y, threat.x, threat.y) <= OPEN_HOLD && LS.los.lineClear(u.x, u.y, threat.x, threat.y, LS.los.blocksShot)) return threat;
    const path = navPath(u, threat);
    for (let i = 1; i < path.length; i++) {
      const p = path[i];
      if (LS.los.isDoor(p.x, p.y)) {
        if (LS.los.dist(u.x, u.y, p.x, p.y) <= DOOR_HOLD && LS.los.lineClear(u.x, u.y, p.x, p.y, LS.los.blocksShot)) return p;
        return null; // the chokepoint ahead is too far to hold yet — close in on it instead
      }
    }
    return null;
  }
  // ALERT pursuit with a search-and-return: head for the lead; on reaching a cold trail, guard that
  // spot for a turn, then walk home to your post — so a search reads as sweep-then-return, not a
  // guard frozen on an empty tile. A fresh lead anywhere cancels it and pursuit resumes. On the way,
  // a guard that already covers a doorway/approach holds overwatch there (reaction shot reserved)
  // rather than charging into the open.
  function huntDecision(u) {
    const post = u.post || { x: u.x, y: u.y };
    const goal = huntGoal(u);
    if (!goal) { u.searchPhase = null; return guardIdle(u, post); } // no lead at all — just hold station
    const near = (s) => s && Math.abs(s.x - goal.x) + Math.abs(s.y - goal.y) <= 2;

    if (u.searchPhase && !near(u.searchSpot)) u.searchPhase = null;       // a new lead — drop the old search
    if (!u.searchPhase && near(u.searchedSpot)) return guardIdle(u, post); // already swept this — hold at post

    if (u.searchPhase === 'guard') {
      if (u.searchTurn === LS.state.turnCount) return guardIdle(u, u.searchSpot, 'search'); // guard the area this turn
      u.searchPhase = 'return';                                          // a turn has passed — head home
    }
    if (u.searchPhase === 'return') {
      if (LS.los.dist(u.x, u.y, post.x, post.y) <= 1) { u.searchPhase = null; return guardIdle(u, post); }
      return u.ap >= cfg().ap.moveOrtho ? navStep(u, post, 'return') : { type: 'end' };
    }
    // pursuing the lead
    if (u.ap < cfg().ap.moveOrtho) return { type: 'end' };
    // sentries hold overwatch on a chokepoint they cover (reaction shot reserved); patrollers are the
    // rovers — they keep pushing and searching, so the squad both covers the approaches and hunts.
    if (!u.patrol && LS.game.alertLevel(u.team) === 'alert' && LS.game.canSnap(u)) {
      const watch = chokepointToward(u, goal);
      if (watch) return { type: 'overwatch', at: watch };
    }
    const act = LS.los.dist(u.x, u.y, goal.x, goal.y) <= 1 ? { type: 'end' } : navStep(u, goal, 'hunt');
    if (act.type === 'end') { // reached the spot (or blocked) — begin guarding it, remember we swept it
      u.searchPhase = 'guard'; u.searchSpot = { x: u.x, y: u.y };
      u.searchedSpot = { x: goal.x, y: goal.y }; u.searchTurn = LS.state.turnCount;
      return guardIdle(u, u.searchSpot, 'search');
    }
    return act;
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
  function nearestWindow(x, y, r) { // a window within r tiles, to glance out of
    let best = null, bestD = r + 1;
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= cfg().cols || yy >= cfg().rows || !LS.los.isWindow(xx, yy)) continue;
      const d = LS.los.dist(x, y, xx, yy); if (d < bestD) { bestD = d; best = { x: xx, y: yy }; }
    }
    return best;
  }
  function roamTile(u, anchor, r) { // a reachable tile a couple of steps off, within r of the anchor (a short stroll)
    const reach = LS.game.computeReachable(u), cols = cfg().cols, opts = [];
    reach.cost.forEach((ap, k) => {
      const x = k % cols, y = Math.floor(k / cols);
      if (Math.max(Math.abs(x - anchor.x), Math.abs(y - anchor.y)) > r) return;
      if (LS.los.dist(x, y, u.x, u.y) < 2) return;
      opts.push({ x, y });
    });
    return opts.length ? opts[LS.util.randInt(0, opts.length - 1)] : null;
  }
  // a guard holding station around an anchor: ONE behaviour a turn from a small grab-bag — look out
  // a nearby window, take a short stroll around the spot, shift a tile, or just scan the arc. Used by
  // calm stationary guards (anchored to their post) and by a searcher guarding a cold trail.
  function guardIdle(u, anchor, reason) {
    if (u._pacedTurn === LS.state.turnCount) return { type: 'end' };
    u._pacedTurn = LS.state.turnCount;
    reason = reason || 'patrol';
    const roll = LS.util.randInt(1, 100);
    const win = nearestWindow(u.x, u.y, 3);
    if (win && roll <= 28) return { type: 'face', dir: LS.util.dirIndex(win.x - u.x, win.y - u.y), look: 'window' };
    if (roll <= 58) { const dest = roamTile(u, anchor, 3); if (dest) return { type: 'move', dest, reason }; }
    if (roll <= 76) { const dest = shuffleStep(u, anchor); if (dest) return { type: 'move', dest, reason }; }
    return { type: 'face', dir: scanDir(u), look: 'scan' };
  }
  // a patroller's loop: a handful of spread-out waypoints across the door-connected building,
  // computed once by flooding the rooms from the post (doors count as passable) and then
  // farthest-point sampling. The patroller navigates door-aware between them, opening doors, and
  // cycles — so it genuinely tours the building rather than pacing one corridor.
  function patrolRoute(u) {
    if (u.route !== undefined) return u.route;
    const cols = cfg().cols, rows = cfg().rows, K = (x, y) => y * cols + x;
    const post = u.post || { x: u.x, y: u.y };
    const seen = new Set([K(post.x, post.y)]), q = [{ x: post.x, y: post.y }], floor = [];
    const CARD = [LS.DIRS[0], LS.DIRS[2], LS.DIRS[4], LS.DIRS[6]];
    // flood the BUILDING only: interior floor ('_') and the doors between rooms. Doors that lead
    // outside are entered but the grass beyond isn't, so the loop stays inside the mansion.
    while (q.length) {
      const c = q.shift();
      for (const nd of CARD) {
        const nx = c.x + nd.dx, ny = c.y + nd.dy, nk = K(nx, ny);
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(nk)) continue;
        const door = LS.los.isDoor(nx, ny);
        const interior = LS.los.tileChar(nx, ny) === '_';
        if (!door && !interior) continue;          // confine the patrol to the building's rooms
        seen.add(nk); q.push({ x: nx, y: ny });
        if (interior) floor.push({ x: nx, y: ny }); // a room tile we could patrol to
      }
    }
    const route = [{ x: post.x, y: post.y }];
    for (let n = 0; n < 3 && floor.length; n++) { // pick up to 3 maximally-spread waypoints
      let best = null, bestMin = -1;
      for (const t of floor) {
        let md = Infinity;
        for (const r of route) md = Math.min(md, LS.los.dist(t.x, t.y, r.x, r.y));
        if (md > bestMin) { bestMin = md; best = t; }
      }
      if (!best || bestMin < 4) break; // nothing meaningfully far left to visit
      route.push(best);
    }
    u.route = route.length >= 2 ? route : null;
    u.routeIdx = 1;
    return u.route;
  }
  function patrolDecision(u) {
    const post = u.post || { x: u.x, y: u.y };
    if (u.patrol) { // a patroller: walk the building loop, opening doors and checking windows en route
      const win = nearestWindow(u.x, u.y, 2); // glance out a window it's passing on the round
      if (win && LS.util.randInt(1, 100) <= 22) return { type: 'face', dir: LS.util.dirIndex(win.x - u.x, win.y - u.y), look: 'window' };
      const route = patrolRoute(u);
      if (route) {
        if (u.routeIdx === undefined) u.routeIdx = 1;
        const wp = route[u.routeIdx % route.length];
        if (LS.los.dist(u.x, u.y, wp.x, wp.y) <= 1) { u.routeIdx = (u.routeIdx + 1) % route.length; return { type: 'face', dir: scanDir(u), look: 'scan' }; }
        const act = navStep(u, wp, 'patrol'); // no one-action cap — let it cross rooms and open doors this turn
        if (act && act.type !== 'end') return act;
      }
      return { type: 'face', dir: scanDir(u), look: 'scan' };
    }
    return guardIdle(u, post); // a stationary guard: hold station with the idle repertoire
  }

  // one action: big grenade > break contact when hurt > shoot > grenade a target we can't shoot >
  // clear glass > reposition > open a door > hold
  function decide(u) {
    const t = bestTarget(u);
    const nade = bestGrenade(u);
    if (nade && nade.blue >= 2) return { type: 'throw', at: nade }; // a grenade that catches two+ is too good to skip
    const hurt = u.hp <= Math.max(3, Math.ceil(u.maxHp * 0.3));
    if (hurt && u.ap >= cfg().ap.moveOrtho && threatenedAt(u, u.x, u.y)) {
      const killShot = t && LS.game.hitChance(u, t.x, t.y, 'aimed') >= 0.5 && t.hp <= W(u).dmgMax;
      if (!killShot) {                                          // badly hurt and exposed: fall back, unless a kill is right there
        const safe = retreatTile(u);
        if (safe && (safe.x !== u.x || safe.y !== u.y)) return { type: 'move', dest: safe, reason: 'retreat' };
      }
    }
    // out of ammo with a fresh clip, and there's reason to be ready (a foe in sight, or on alert): reload
    if (u.ammo <= 0 && u.clips > 0 && u.ap >= cfg().ap.reload &&
      (enemiesSeen(u).length || LS.game.alertLevel(u.team) === 'alert')) return { type: 'reload' };
    if (t) { // a clear shot: take the accurate aimed shot if we can afford it, else a cheap snap
      if (u.ap >= W(u).modes.aimed.ap) return { type: 'fire', target: t, mode: 'aimed' };
      if (u.ap >= W(u).modes.snap.ap) return { type: 'fire', target: t, mode: 'snap' };
      return { type: 'end' };
    }
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
    if (glass && LS.game.canSnap(u)) return { type: 'shootWindow', at: glass };
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
      case 'fire':        return { text: `${action.mode === 'snap' ? 'snap' : 'aimed'} shot at ${action.target.name}`, color: '#ff5d5d' };
      case 'reload':      return { text: 'reloading', color: '#9a946f' };
      case 'throw':       return { text: 'grenade out', color: '#ff9a3c' };
      case 'shootWindow': return { text: 'clearing a window', color: '#5fbcc6' };
      case 'openDoor':    return { text: 'opening a door', color: '#c8a23c' };
      case 'overwatch':   return { text: 'holding overwatch', color: '#ff9a3c' };
      case 'face':        return { text: action.look === 'window' ? 'watching a window' : 'scanning', color: '#9a946f' };
      case 'move':
        if (action.reason === 'retreat') return { text: 'falling back', color: '#5fbcc6' };
        if (action.reason === 'hunt')    return { text: 'closing on last sighting', color: '#e6ad33' };
        if (action.reason === 'search')  return { text: 'searching the area', color: '#e6ad33' };
        if (action.reason === 'return')  return { text: 'back to post', color: '#9a946f' };
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
  // --- enemy-turn readability: lead the eye to the action and pace it so the player can parse it ---
  const beat = () => LS.config.anim.aiBeat || 320; // a readable hold after a toured action
  const EARSHOT = 8; // an enemy action this near one of your soldiers is heard/sensed (toured); farther is silent
  function audible(x, y) {
    const V = LS.game.viewTeam();
    return LS.state.units.some(u => u.alive && u.team === V && LS.los.dist(u.x, u.y, x, y) <= EARSHOT);
  }
  // pan the camera near a point so the eye follows the turn, then hold a beat. Exact if the player
  // can see it; jittered a tile or two if it's in the fog (you sense roughly where, not exactly).
  function tourTo(x, y, seen, done) {
    let tx = x, ty = y;
    if (!seen) {
      tx = LS.util.clamp(x + (LS.util.randInt(0, 1) ? 1 : -1) * LS.util.randInt(1, 2), 0, cfg().cols - 1);
      ty = LS.util.clamp(y + (LS.util.randInt(0, 1) ? 1 : -1) * LS.util.randInt(1, 2), 0, cfg().rows - 1);
    }
    LS.render.focusTile(tx, ty, () => delay(beat(), done));
  }

  // the human's soldiers overwatching an advancing AI unit get their reaction shot
  function resolveReactions(mover, reactors, done) {
    let j = 0;
    (function next() {
      if (j >= reactors.length || !mover.alive || LS.state.over) return done();
      const r = reactors[j++];
      if (!LS.game.canSnap(r) || !LS.los.canSee(r, mover.x, mover.y)) return next();
      const res = LS.game.fire(r, mover, { reaction: true });
      LS.render.shotFx(r, mover, res, () => { LS.render.draw(); delay(180, next); });
    })();
  }

  function aiFire(shooter, target, mode, done) {
    const res = LS.game.fire(shooter, target, { mode: mode || 'aimed' });
    if (!res.ok) return done();
    const seen = seenByHuman(shooter.x, shooter.y) || watching(); // can the player actually see who fired?
    if (seen) LS.render.reveal(shooter.id); // we can see them — show the shooter for the shot
    // frame the shooter if visible; otherwise the (always-visible) victim, so a shot from the dark
    // reads as your soldier being hit from nowhere, not the enemy giving its position away
    const fx = seen ? shooter : (target.team === LS.game.viewTeam() ? target : shooter);
    LS.render.focusTile(fx.x, fx.y, () => {
      LS.render.draw();
      LS.render.shotFx(shooter, target, res, () => {
        if (seen) LS.render.unreveal(shooter.id);
        LS.render.draw();
        delay(160, done);
      });
    });
  }

  function aiThrow(unit, at, done) {
    const res = LS.game.throwGrenade(unit, at.x, at.y);
    if (!res.ok) return done();
    const seen = seenByHuman(unit.x, unit.y) || watching();
    if (seen) LS.render.reveal(unit.id); // show the thrower only if we can see them
    LS.render.focusTile(at.x, at.y, () => { // show where it lands (it is near your soldiers, so on screen)
      LS.render.draw();
      LS.render.throwArc(unit, { x: at.x, y: at.y }, () => {
        if (seen) LS.render.unreveal(unit.id);
        LS.render.draw();
        delay(180, done);
      });
    });
  }

  function aiShootGlass(unit, at, done) {
    const res = LS.game.shootWindow(unit, at.x, at.y);
    if (!res.ok) return done();
    const seen = seenByHuman(unit.x, unit.y) || watching();
    if (seen) LS.render.reveal(unit.id);
    LS.render.focusTile(seen ? unit.x : at.x, seen ? unit.y : at.y, () => {
      LS.render.draw();
      LS.render.shotFx(unit, { x: at.x, y: at.y }, { ok: true, hit: true, glass: true }, () => {
        if (seen) LS.render.unreveal(unit.id);
        LS.render.draw();
        delay(160, done);
      });
    });
  }

  function aiOpenDoor(unit, at, done) {
    const res = LS.game.toggleDoor(unit, at.x, at.y);
    if (!res.ok) return done();
    if (seenByHuman(unit.x, unit.y) || seenByHuman(at.x, at.y) || watching()) { // we can see it — reveal & show
      LS.sound.play('door');
      LS.render.reveal(unit.id);
      LS.render.focusTile(unit.x, unit.y, () => {
        LS.render.draw();
        delay(240, () => { LS.render.unreveal(unit.id); LS.render.draw(); done(); });
      });
    } else if (audible(at.x, at.y)) { // out of sight but within earshot — pan near it and let you hear it
      LS.render.draw();
      LS.sound.play('door');
      tourTo(at.x, at.y, false, done);
    } else {
      LS.render.draw();
      done(); // too far to hear — resolve quietly
    }
  }

  function aiMove(unit, path, done) {
    let i = 1, wasVisible = seenByHuman(unit.x, unit.y);
    const dest = path[path.length - 1];
    const fogTour = !wasVisible && !watching() && audible(dest.x, dest.y); // heard moving in the dark nearby
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
          i++; step();           // the camera tracks the mover smoothly inside animateStep
        };
        if (reactors.length) { LS.render.draw(); resolveReactions(unit, reactors, after); }
        else after();
      };
      if (wasVisible || watching()) { // visible to the human (or we're watching the AI): glide it so they can watch
        LS.render.animateStep(unit, from, to, finishStep);
      } else if (LS.config.anim.enabled && audible(to.x, to.y)) {
        // in the dark but within earshot: a paced footfall so you hear the enemy on the move nearby
        LS.sound.play('step');
        setTimeout(finishStep, 200);
      } else {
        finishStep(); // too far to hear (or no anim) — resolve instantly and silently
      }
    }
    // lead the eye near an audible fog move before it resolves, so you sense where it's coming from
    if (fogTour) tourTo(dest.x, dest.y, false, step); else step();
  }

  function aiReload(unit, done) { // swap a fresh clip; spends AP, plays the door/mechanical click
    LS.game.reload(unit);
    if (seenByHuman(unit.x, unit.y) || watching()) { LS.render.reveal(unit.id); LS.render.draw(); LS.render.unreveal(unit.id); }
    LS.sound.play('door');
    delay(beat(), done);
  }

  function aiFace(unit, dir, done) { // a scan: turn on the spot, no AP — so the unit's go ends after it
    if (typeof dir === 'number' && dir >= 0) unit.facing = dir;
    LS.render.draw();
    delay(120, done);
  }

  function aiOverwatch(unit, at, done) { // hold position facing the approach; spend no AP, so a shot stays in hand
    LS.game.faceToward(unit, at.x, at.y);
    LS.render.draw();
    delay(140, done);
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
      if (action.type === 'fire') return aiFire(u, action.target, action.mode, cont);
      if (action.type === 'reload') return aiReload(u, cont);
      if (action.type === 'throw') return aiThrow(u, action.at, cont);
      if (action.type === 'shootWindow') return aiShootGlass(u, action.at, cont);
      if (action.type === 'openDoor') return aiOpenDoor(u, action.at, cont);
      if (action.type === 'overwatch') return aiOverwatch(u, action.at, cont);
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
      actUnit(u, () => delay(beat(), nextUnit)); // a readable pause between soldiers
    }
    delay(350, nextUnit); // a beat so the human registers the turn change
  }

  return { takeTurn, decide, bestTarget, engageTile };
})();
