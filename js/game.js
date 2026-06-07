// game.js — the single source of truth. State lives here; the SVG just reflects it.
LS.game = (function () {
  const { clamp, randInt, dirIndex, teamName } = LS.util;

  function newGame() {
    const units = LS.level.units.map(u => ({
      ...u,
      hp: LS.level.unitHp,
      maxHp: LS.level.unitHp,
      ap: LS.config.ap.max,
      alive: true,
      grenades: LS.config.grenade.count,
    }));
    LS.state = {
      units,
      activeTeam: 'blue',
      selectedId: null,
      reach: null,        // cached movement field for the selected unit
      log: [],
      over: false,
      winner: null,
      busy: false,        // true while a move is animating; blocks input
      turnCount: 1,
      handoff: false,     // true between turns: show the pass-the-device screen
      knowledge: { blue: {}, red: {} }, // per team: enemyId -> last-seen {x,y,facing,turn}
      doorsOpen: new Set(),       // keys of doors currently open (default: all closed)
      windowsSmashed: new Set(),  // keys of windows broken (default: all intact)
      liveGrenades: [],           // {x,y,team} thrown this turn, detonate at end of turn (cook)
      throwMode: null,            // unit id currently aiming a grenade, or null
      rubble: new Set(),          // tiles blown open by a blast (now passable + see/shoot through)
      craters: new Set(),         // tiles cratered by a blast (impassable holes)
      wallHp: new Map(),          // hidden durability per breakable wall: key -> {hp, max}
      cam: { x: 0, y: 0 },        // camera top-left in world pixels (the scroll position)
      // red squad awareness: 'calm' = on patrol; 'alert' = has spotted the player and hunts.
      // latched = can never stand down (a shot was fired, or two+ guards have sighted you).
      alert: { red: { level: 'calm', latched: false, seers: {}, contactSince: false, quiet: 0, focus: null, pendingCallout: null } },
    };
    // give every breakable wall a hidden, randomised durability
    for (let y = 0; y < LS.config.rows; y++)
      for (let x = 0; x < LS.config.cols; x++)
        if (LS.level.map[y][x] === 'x') {
          const hp = randInt(LS.config.grenade.wallHpMin, LS.config.grenade.wallHpMax);
          LS.state.wallHp.set(key(x, y), { hp, max: hp });
        }
    observe();
    log(`${teamName('blue')} squad, move out. Click one of your soldiers.`);
    return LS.state;
  }

  // --- lookups -------------------------------------------------------------
  const key = (x, y) => y * LS.config.cols + x;
  function unitAt(x, y) {
    return LS.state.units.find(u => u.alive && u.x === x && u.y === y) || null;
  }
  function unitById(id) { return LS.state.units.find(u => u.id === id) || null; }
  function selected() { return LS.state.selectedId ? unitById(LS.state.selectedId) : null; }
  function teamUnits(team) { return LS.state.units.filter(u => u.alive && u.team === team); }

  function isPassable(x, y) {
    if (LS.los.blocksMove(x, y)) return false; // wall, window, or closed door
    if (unitAt(x, y)) return false;
    return true;
  }

  // --- movement field (Dijkstra over AP cost) ------------------------------
  function computeReachable(unit) {
    const { cols, rows } = LS.config;
    const cost = new Map(), prev = new Map();
    cost.set(key(unit.x, unit.y), 0);
    const pq = [{ x: unit.x, y: unit.y, c: 0 }];
    while (pq.length) {
      let mi = 0;
      for (let i = 1; i < pq.length; i++) if (pq[i].c < pq[mi].c) mi = i;
      const cur = pq.splice(mi, 1)[0];
      if (cur.c > (cost.get(key(cur.x, cur.y)) ?? Infinity)) continue;
      for (let d = 0; d < 8; d++) {
        const nd = LS.DIRS[d];
        const nx = cur.x + nd.dx, ny = cur.y + nd.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!isPassable(nx, ny)) continue;
        const diag = nd.dx !== 0 && nd.dy !== 0;
        // no cutting through the corner of a wall / door / window
        if (diag && (LS.los.blocksMove(cur.x + nd.dx, cur.y) || LS.los.blocksMove(cur.x, cur.y + nd.dy))) continue;
        const nc = cur.c + (diag ? LS.config.ap.moveDiag : LS.config.ap.moveOrtho);
        if (nc > unit.ap) continue;
        if (nc < (cost.get(key(nx, ny)) ?? Infinity)) {
          cost.set(key(nx, ny), nc);
          prev.set(key(nx, ny), key(cur.x, cur.y));
          pq.push({ x: nx, y: ny, c: nc });
        }
      }
    }
    return { cost, prev, key };
  }

  function pathTo(reach, x, y) {
    const k = key(x, y);
    if (!reach.cost.has(k)) return null;
    const path = [];
    let cur = k;
    while (cur !== undefined) {
      path.unshift({ x: cur % LS.config.cols, y: Math.floor(cur / LS.config.cols) });
      cur = reach.prev.get(cur);
    }
    return path; // includes the start tile at index 0
  }

  function refreshReach() {
    const u = selected();
    LS.state.reach = (u && u.team === LS.state.activeTeam && !LS.state.over) ? computeReachable(u) : null;
  }

  // --- fog of war: vision and knowledge --------------------------------------
  // every tile a team's living soldiers can collectively see
  function teamVision(team) {
    const vis = new Set();
    LS.state.units.filter(u => u.alive && u.team === team).forEach(u => {
      for (let y = 0; y < LS.config.rows; y++)
        for (let x = 0; x < LS.config.cols; x++)
          if (LS.los.canSee(u, x, y)) vis.add(key(x, y));
    });
    return vis;
  }

  // who's a computer player, and whose eyes we render the board through.
  // active team = whose turn it is (control/AP); view team = who's watching the screen.
  // They match in hot-seat; during an AI turn the human keeps watching, so they differ.
  function isAI(team) { return (LS.config.aiTeams || []).includes(team); }
  function viewTeam() {
    const at = LS.state.activeTeam;
    if (!isAI(at)) return at;                       // a human is acting — they watch their own turn
    return ['blue', 'red'].find(t => !isAI(t)) || at; // an AI is acting — the human watches
  }

  function isVisible(u) {
    const vt = viewTeam();
    if (u.team === vt) return true;
    return teamVision(vt).has(key(u.x, u.y));
  }

  // ids of living enemies a team can currently see — used to spot fresh contacts mid-move
  function visibleEnemyIds(team) {
    const vis = teamVision(team), ids = new Set();
    LS.state.units.forEach(e => { if (e.alive && e.team !== team && vis.has(key(e.x, e.y))) ids.add(e.id); });
    return ids;
  }

  // update both teams' last-seen memory of the enemy, each from its own vision.
  // (Both, not just the active team, so the human's ghosts stay correct while the AI moves,
  // and the AI keeps its own memory of where it last saw the player.)
  function observe() {
    ['blue', 'red'].forEach(team => {
      const vis = teamVision(team);
      const know = LS.state.knowledge[team];
      LS.state.units.filter(u => u.team !== team).forEach(e => {
        if (!e.alive) { delete know[e.id]; return; }
        if (vis.has(key(e.x, e.y))) {
          know[e.id] = { x: e.x, y: e.y, facing: e.facing, turn: LS.state.turnCount };
        } else if (know[e.id] && vis.has(key(know[e.id].x, know[e.id].y))) {
          delete know[e.id]; // we can see the spot we last saw them and they've gone
        }
      });
    });
    senseAlert(null); // a vision change may mean a guard has just sighted the player
  }

  // --- red squad awareness: calm patrol vs alert ----------------------------
  // Red holds a guard routine until one of its soldiers sights one of yours (or a shot
  // is fired). It then goes 'alert' — and acts on last-known positions instead of only
  // what it can see this instant. The alert LATCHES (never stands down) once a shot has
  // been fired or a SECOND guard has independently sighted you; a single silent glimpse
  // can fade back to calm after a couple of quiet turns. Comms are assumed: alert is squad-wide.
  const ALERT_COOLDOWN = 2;        // red turns of no contact before a non-latched alert relaxes
  function alertInfo(team) { return LS.state.alert[team]; }
  function alertLevel(team) { return (LS.state.alert[team] || {}).level || 'calm'; }
  // the map carved into six named sectors (W/C/E × N/S), for the "sector 2" callout
  function sector(x, y) {
    const col = x < 15 ? 0 : x < 30 ? 1 : 2;
    const row = y < 16 ? 0 : 1;
    return row * 3 + col + 1; // 1..6
  }
  // red guards that can right now see one of the player's soldiers (and who they see)
  function redSeers() {
    const out = [];
    LS.state.units.forEach(g => {
      if (!g.alive || g.team !== 'red') return;
      const t = LS.state.units.find(e => e.alive && e.team === 'blue' && LS.los.canSee(g, e.x, e.y));
      if (t) out.push({ guard: g, target: t });
    });
    return out;
  }
  function nearestKnownBlue(from) {
    const know = LS.state.knowledge.red, ids = Object.keys(know);
    if (!ids.length) return null;
    let best = null, bestScore = Infinity;
    ids.forEach(id => {
      const k = know[id];
      const score = from ? LS.los.dist(from.x, from.y, k.x, k.y) : (LS.state.turnCount - k.turn);
      if (score < bestScore) { bestScore = score; best = k; }
    });
    return best;
  }
  // called when vision changes (from observe) or a shot is fired (shotAt = the noise's origin).
  // raises the alert and, on the calm→alert edge, stages a callout for the UI to play.
  function senseAlert(shotAt) {
    const a = LS.state.alert.red;
    const seers = redSeers();
    if (!seers.length && !shotAt) return;
    const wasCalm = a.level === 'calm';
    seers.forEach(s => { a.seers[s.guard.id] = true; }); // remember distinct guards who've sighted you
    const contact = (seers[0] && seers[0].target) || shotAt || nearestKnownBlue(null);
    if (contact) a.focus = { x: contact.x, y: contact.y };
    a.level = 'alert';
    a.contactSince = true;
    if (shotAt || Object.keys(a.seers).length >= 2) a.latched = true;
    if (wasCalm) a.pendingCallout = { sector: a.focus ? sector(a.focus.x, a.focus.y) : 1 };
  }
  // at the start of each red turn: a non-latched alert relaxes after enough quiet turns
  function coolDownTick() {
    const a = LS.state.alert.red;
    if (a.level !== 'alert' || a.latched) { a.contactSince = false; return; }
    if (a.contactSince) a.quiet = 0;
    else if (++a.quiet >= ALERT_COOLDOWN) { a.level = 'calm'; a.seers = {}; a.quiet = 0; a.focus = null; }
    a.contactSince = false;
  }

  // tiles that enemies the team can currently SEE are able to watch — the fair danger warning
  function enemyDangerSet(team, vision) {
    const set = new Set();
    LS.state.units
      .filter(e => e.alive && e.team !== team && vision.has(key(e.x, e.y)))
      .forEach(e => {
        for (let y = 0; y < LS.config.rows; y++)
          for (let x = 0; x < LS.config.cols; x++)
            if (LS.los.canSee(e, x, y)) set.add(key(x, y));
      });
    return set;
  }

  // --- actions -------------------------------------------------------------
  function selectUnit(id) {
    LS.state.selectedId = id;
    LS.state.throwMode = null; // changing selection cancels grenade aiming
    refreshReach();
  }

  // a single tile of a move: deduct AP, face the way we stepped, update position.
  // Called step-by-step so a move can be interrupted by reaction fire.
  function applyStep(unit, from, to) {
    const diag = from.x !== to.x && from.y !== to.y;
    unit.ap -= diag ? LS.config.ap.moveDiag : LS.config.ap.moveOrtho;
    unit.facing = dirIndex(to.x - from.x, to.y - from.y);
    unit.x = to.x; unit.y = to.y;
    observe(); // reveal whatever the mover can now see
  }

  // enemies who can see the mover (in arc) AND have a clear shot AND the AP to take it.
  // The two LOS checks differ at glass: a defender behind intact glass sees you but can't fire.
  function findReactors(mover) {
    const w = LS.level.weapon;
    return LS.state.units
      .filter(u => u.alive && u.team !== mover.team && u.ap >= w.fireCost &&
        LS.los.canSee(u, mover.x, mover.y) && LS.los.canTarget(u, mover.x, mover.y))
      .sort((a, b) => LS.los.dist(a.x, a.y, mover.x, mover.y) - LS.los.dist(b.x, b.y, mover.x, mover.y));
  }

  // --- breachable barriers: doors and windows --------------------------------
  const orthAdjacent = (u, x, y) => Math.abs(u.x - x) + Math.abs(u.y - y) === 1;

  function toggleDoor(unit, x, y) {
    if (!LS.los.isDoor(x, y)) return { ok: false };
    if (!orthAdjacent(unit, x, y)) return { ok: false, reason: 'Move next to the door first.' };
    if (unit.ap < LS.config.ap.door) return { ok: false, reason: 'Not enough AP for the door.' };
    unit.ap -= LS.config.ap.door;
    const kk = key(x, y), wasOpen = LS.state.doorsOpen.has(kk);
    if (wasOpen) LS.state.doorsOpen.delete(kk); else LS.state.doorsOpen.add(kk);
    faceToward(unit, x, y);
    observe(); refreshReach();
    log(`${unit.name} ${wasOpen ? 'closes' : 'opens'} the door.`);
    return { ok: true };
  }

  function smashWindowMelee(unit, x, y) {
    if (!LS.los.isWindow(x, y) || LS.los.windowSmashed(x, y)) return { ok: false };
    if (!orthAdjacent(unit, x, y)) return { ok: false, reason: 'Move next to the window first.' };
    if (unit.ap < LS.config.ap.door) return { ok: false, reason: 'Not enough AP to smash it.' };
    unit.ap -= LS.config.ap.door;
    LS.state.windowsSmashed.add(key(x, y));
    faceToward(unit, x, y);
    observe(); refreshReach();
    log(`${unit.name} smashes the window.`);
    return { ok: true };
  }

  // smash a window with no actor/AP (used when a shot's path or a stray miss meets the glass)
  function breakWindow(x, y) {
    if (LS.los.isWindow(x, y) && !LS.los.windowSmashed(x, y)) {
      LS.state.windowsSmashed.add(key(x, y));
      observe();
    }
  }

  // break a window with a shot from range (the round shatters the glass and stops — no pass-through)
  function shootWindow(unit, x, y) {
    if (!LS.los.isWindow(x, y) || LS.los.windowSmashed(x, y)) return { ok: false };
    if (unit.ap < LS.level.weapon.fireCost) return { ok: false, reason: 'Not enough AP to fire.' };
    if (!LS.los.canTarget(unit, x, y)) return { ok: false, reason: 'No line of sight to the window.' };
    unit.ap -= LS.level.weapon.fireCost;
    faceToward(unit, x, y);
    LS.state.windowsSmashed.add(key(x, y));
    observe();
    senseAlert({ x: unit.x, y: unit.y }); // a gunshot, even at glass
    refreshReach();
    log(`${unit.name} shatters the window with a shot.`);
    return { ok: true };
  }

  function faceToward(unit, tx, ty) {
    const di = dirIndex(tx - unit.x, ty - unit.y);
    if (di >= 0) unit.facing = di;
  }

  // Is the target shielded by a wall on the side the shot comes from?
  function inCoverFrom(tx, ty, fx, fy) {
    const d = LS.DIRS[LS.util.nearestDir(fx - tx, fy - ty)]; // step from target toward shooter
    return LS.los.givesCover(tx + d.dx, ty + d.dy); // reinforced or intact breakable wall
  }

  // single source of truth for hit chance, so the hover % always matches the real shot
  function hitChance(shooter, tx, ty) {
    const d = LS.los.dist(shooter.x, shooter.y, tx, ty);
    let c = LS.config.combat.baseAccuracy - d * LS.config.combat.falloffPerTile;
    if (inCoverFrom(tx, ty, shooter.x, shooter.y)) c -= LS.config.combat.coverPenalty;
    return clamp(c, LS.config.combat.minHit, LS.config.combat.maxHit);
  }

  // opts.reaction: a reaction shot — skips the LOS gate (caller checked) and doesn't re-aim the watcher
  function fire(shooter, target, opts = {}) {
    const w = LS.level.weapon;
    if (shooter.ap < w.fireCost) return { ok: false, reason: 'Not enough AP to fire.' };
    if (!opts.reaction && !LS.los.canTarget(shooter, target.x, target.y)) return { ok: false, reason: 'No line of sight.' };

    shooter.ap -= w.fireCost;
    if (!opts.reaction) faceToward(shooter, target.x, target.y);
    const chance = hitChance(shooter, target.x, target.y);
    const tag = opts.reaction ? 'reaction — ' : '';

    const res = { ok: true, hit: false, dmg: 0, killed: false, chance, reaction: !!opts.reaction };
    if (Math.random() <= chance) {
      const dmg = randInt(w.dmgMin, w.dmgMax);
      target.hp = Math.max(0, target.hp - dmg);
      res.hit = true; res.dmg = dmg;
      if (target.hp === 0) { target.alive = false; res.killed = true; }
      const tail = res.killed ? ` — ${target.name} is down!` : '';
      log(`${tag}${shooter.name} hits ${target.name} for ${dmg}${tail} (${Math.round(chance * 100)}%)`);
    } else {
      log(`${tag}${shooter.name} fires at ${target.name} and misses (${Math.round(chance * 100)}%)`);
    }
    observe();
    senseAlert({ x: shooter.x, y: shooter.y }); // gunfire carries — the red squad hears it
    refreshReach();
    checkWin();
    return res;
  }

  // --- grenades (cooked: thrown now, detonate at end of turn) -----------------
  function canThrowTo(unit, x, y) {
    if (LS.los.dist(unit.x, unit.y, x, y) > LS.config.grenade.range) return false;
    return !LS.los.blocksMove(x, y); // can't land it inside a wall/window/closed door
  }

  function throwGrenade(unit, x, y) {
    if (unit.grenades <= 0) return { ok: false, reason: 'No grenades left.' };
    if (unit.ap < LS.config.grenade.throwCost) return { ok: false, reason: 'Not enough AP to throw.' };
    if (!canThrowTo(unit, x, y)) return { ok: false, reason: 'Out of range, or no clear spot to land it.' };
    unit.grenades -= 1;
    unit.ap -= LS.config.grenade.throwCost;
    faceToward(unit, x, y);
    LS.state.liveGrenades.push({ x, y, team: unit.team });
    refreshReach();
    log(`${unit.name} lobs a grenade. It'll go off at end of turn — clear the blast!`);
    return { ok: true };
  }

  // tiles a blast at (cx,cy) reaches: within the radius (diamond) and not behind a wall/closed door
  function blastTiles(cx, cy) {
    const R = LS.config.grenade.radius, out = [];
    for (let y = cy - R; y <= cy + R; y++) {
      for (let x = cx - R; x <= cx + R; x++) {
        if (x < 0 || y < 0 || x >= LS.config.cols || y >= LS.config.rows) continue;
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d > R) continue;
        if (d > 0 && !LS.los.lineClear(cx, cy, x, y, LS.los.blocksSight)) continue; // walls/closed doors stop it
        out.push({ x, y, d });
      }
    }
    return out;
  }

  // detonate one grenade: apply falloff damage to every unit in the blast (friendly fire included)
  function detonateGrenade(g) {
    const G = LS.config.grenade;
    const hits = [];
    let wallsDown = 0, wallsHit = 0;
    blastTiles(g.x, g.y).forEach(({ x, y, d }) => {
      const c = LS.los.tileChar(x, y), kk = key(x, y);
      // the blast blows out any intact window it reaches (it already passes through glass to hit beyond)
      if (c === 'W' && !LS.los.windowSmashed(x, y)) LS.state.windowsSmashed.add(kk);
      // a destructible door is flimsy: a close blast blows it apart
      if (c === 'D' && d <= G.wallBreakRadius && !LS.state.rubble.has(kk)) LS.state.rubble.add(kk);
      // a breakable wall takes blast damage off its hidden HP; it only collapses once that runs out
      if (c === 'x' && !LS.state.rubble.has(kk)) {
        const wd = Math.max(0, Math.round(G.wallDmgCenter - d * G.wallDmgFalloff));
        if (wd > 0) {
          const w = LS.state.wallHp.get(kk) || { hp: G.wallHpMax, max: G.wallHpMax };
          w.hp -= wd; LS.state.wallHp.set(kk, w);
          if (w.hp <= 0) { LS.state.rubble.add(kk); wallsDown++; } else wallsHit++;
        }
      }
      const u = unitAt(x, y);
      if (!u) return;
      const dmg = Math.max(1, Math.round(G.dmgCenter - d * G.dmgFalloff));
      u.hp = Math.max(0, u.hp - dmg);
      const killed = u.hp === 0;
      if (killed) u.alive = false;
      hits.push({ x, y, dmg, killed, name: u.name });
    });
    // chance the tile it lands on becomes an impassable crater (open ground only)
    const ec = LS.los.tileChar(g.x, g.y);
    if ((ec === '.' || ec === '_') && !LS.state.craters.has(key(g.x, g.y)) && Math.random() < G.craterChance)
      LS.state.craters.add(key(g.x, g.y));
    const parts = [];
    if (hits.length) parts.push(hits.map(h => `${h.name} -${h.dmg}${h.killed ? ' (down)' : ''}`).join(', '));
    if (wallsDown) parts.push(wallsDown > 1 ? `${wallsDown} walls blown open` : 'a wall blown open');
    else if (wallsHit) parts.push('a wall holds');
    log(parts.length ? `Grenade: ${parts.join('; ')}` : 'Grenade detonates.');
    senseAlert({ x: g.x, y: g.y }); // an explosion is about as loud as the level gets
    return hits;
  }

  function endTurn() {
    if (LS.state.over) return;
    LS.state.throwMode = null;
    LS.state.activeTeam = LS.state.activeTeam === 'blue' ? 'red' : 'blue';
    LS.state.turnCount++;
    if (LS.state.activeTeam === 'red') coolDownTick(); // a quiet alert may relax before red acts
    teamUnits(LS.state.activeTeam).forEach(u => { u.ap = LS.config.ap.max; });
    LS.state.selectedId = null;
    LS.state.reach = null;
    LS.state.handoff = true; // hold at the pass-the-device screen until the next player is ready
    log(`— ${teamName(LS.state.activeTeam).toUpperCase()} turn —`);
  }

  // called when the next player taps "ready": refresh their knowledge and let them act
  function resumeTurn() {
    LS.state.handoff = false;
    observe();
    refreshReach();
  }

  function checkWin() {
    const blue = teamUnits('blue').length, red = teamUnits('red').length;
    if (red === 0) { LS.state.over = true; LS.state.winner = 'blue'; log(`${teamName('red')} squad eliminated. ${teamName('blue').toUpperCase()} wins.`); }
    else if (blue === 0) { LS.state.over = true; LS.state.winner = 'red'; log(`${teamName('blue')} squad eliminated. ${teamName('red').toUpperCase()} wins.`); }
  }

  function log(msg) {
    LS.state.log.push(msg);
    if (LS.state.log.length > 40) LS.state.log.shift();
  }

  return {
    newGame, key, unitAt, unitById, selected, teamUnits, isPassable,
    computeReachable, pathTo, refreshReach, selectUnit, faceToward,
    applyStep, findReactors, fire, hitChance, inCoverFrom,
    teamVision, isVisible, visibleEnemyIds, observe, enemyDangerSet, isAI, viewTeam,
    alertLevel, alertInfo, sector,
    toggleDoor, smashWindowMelee, shootWindow,
    canThrowTo, throwGrenade, blastTiles, detonateGrenade, breakWindow,
    endTurn, resumeTurn, checkWin, log,
  };
})();
