// ui.js — the HTML panels around the board: turn banner, selected-unit card, log, victory.
LS.ui = (function () {
  // squad-card status icons: an eye = still able to opportunity-fire; a barred circle = out of AP
  const ICON_EYE = '<svg class="sc-ic" viewBox="0 0 16 12" width="15" height="11" aria-hidden="true"><path d="M1 6 Q8 0.5 15 6 Q8 11.5 1 6Z" fill="none" stroke="#6bd86b" stroke-width="1.4"/><circle cx="8" cy="6" r="2.1" fill="#6bd86b"/></svg>';
  const ICON_SPENT = '<svg class="sc-ic" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="none" stroke="#8a93a0" stroke-width="1.4"/><line x1="2.6" y1="9.4" x2="9.4" y2="2.6" stroke="#8a93a0" stroke-width="1.4"/></svg>';
  const ICON_NADE = '<svg viewBox="0 0 14 16" width="11" height="13" aria-hidden="true"><rect x="5" y="0.5" width="4" height="2.2" rx="0.6" fill="currentColor"/><rect x="8.4" y="1" width="2.6" height="1.4" rx="0.4" fill="currentColor"/><rect x="6" y="2.5" width="2" height="2.2" fill="currentColor"/><circle cx="7" cy="10" r="5" fill="currentColor"/></svg>';
  // the 'blue' team id reads as "Yellow" on screen (see LS.util.teamName — one source of truth)
  const teamLabel = t => LS.util.teamName(t).toUpperCase();
  let lastLogLen = 0, feedTimer = null; // for the on-screen event feed
  function classify(m) {                // colour-code a log line for the feed
    const s = m.toLowerCase();
    if (s.includes('investigat') || m.includes('◆')) return 'investigate';
    if (s.includes('alert') || m.includes('⚠')) return 'alert';
    if (s.includes('down') || s.includes('eliminated') || s.includes('wins')) return 'kill';
    if (s.includes('grenade') || s.includes('blast')) return 'grenade';
    if (s.includes('shatter') || s.includes('window') || s.includes('glass')) return 'glass';
    if (s.includes('hits')) return 'hit';
    if (s.includes('misses')) return 'miss';
    if (s.includes('turn') || s.startsWith('—')) return 'turn';
    return '';
  }
  function update() {
    const s = LS.state;
    // turn banner
    const banner = document.getElementById('turn-banner');
    banner.textContent = s.over ? 'GAME OVER' : `${teamLabel(s.activeTeam)} turn`;
    banner.className = 'turn-banner ' + (s.over ? 'over' : s.activeTeam);
    // the per-team roster headers are static "BLUE"/"RED" placeholders in index.html — relabel them here
    const rl = document.querySelector('.roster-label.blue'); if (rl) rl.textContent = teamLabel('blue');
    const rr = document.querySelector('.roster-label.red'); if (rr) rr.textContent = teamLabel('red');

    // on-screen event feed: recent events flash over the board (colour-coded), then fade when idle
    const feed = document.getElementById('feed');
    if (feed) {
      feed.innerHTML = s.log.slice(-4).reverse()
        .map((m, i) => `<div class="feed-line ${classify(m)}" style="opacity:${[1, 0.72, 0.52, 0.4][i] || 0.4}">${m}</div>`).join('');
      if (s.log.length !== lastLogLen) {   // a new event arrived → flash it up, then fade after a beat
        if (lastLogLen !== 0) LS.sound.play('type'); // typewriter clatter (skip the very first paint)
        lastLogLen = s.log.length;
        feed.classList.add('show');
        clearTimeout(feedTimer);
        feedTimer = setTimeout(() => feed.classList.remove('show'), 4200);
      }
    }

    // squad rosters (each soldier's card carries its own grenade button now)
    renderRoster('roster-blue', 'blue');
    renderRoster('roster-red', 'red');

    // pass-the-device handoff screen
    const ho = document.getElementById('handoff');
    if (s.handoff && !s.over) {
      ho.style.display = 'flex';
      const t = ho.querySelector('.handoff-team');
      t.textContent = teamLabel(s.activeTeam);
      t.className = 'handoff-team ' + s.activeTeam;
    } else {
      ho.style.display = 'none';
    }

    // victory overlay
    const ov = document.getElementById('overlay');
    if (s.over) {
      ov.style.display = 'flex';
      ov.querySelector('.win-text').textContent = `${teamLabel(s.winner)} squad wins`;
      ov.querySelector('.win-text').className = 'win-text ' + s.winner;
    } else {
      ov.style.display = 'none';
    }

    document.getElementById('end-turn').disabled = s.over || s.busy;

    const mb = document.getElementById('mute');
    if (mb) mb.textContent = 'Sound: ' + (LS.sound.isMuted() ? 'off' : 'on');

    const wb = document.getElementById('watch-ai');
    if (wb) { const on = !!(LS.config.debug && LS.config.debug.watchAI); wb.textContent = 'Watch AI: ' + (on ? 'on' : 'off'); wb.classList.toggle('on', on); }
  }

  function renderRoster(elId, team) {
    const box = document.getElementById(elId);
    const known = team === LS.game.viewTeam();   // fog: you only know your own squad's state
    const block = box.parentElement;              // .roster-block
    if (block) block.style.order = known ? '-1' : '0'; // your squad floats to the top
    const units = LS.state.units.filter(u => u.team === team);

    // enemy: fog — just a count of unknowns, never their HP/AP
    if (!known) {
      box.className = 'roster fog';
      box.innerHTML = units.map(() => `<div class="pip ${team} unknown" title="enemy">?</div>`).join('');
      return;
    }

    // your squad: a card each with name, HP, AP, turn-state, and its own grenade button
    box.className = 'roster squad';
    const apMax = LS.config.ap.max, fireCost = LS.level.weapon.fireCost, moveMin = LS.config.ap.moveOrtho;
    const throwCost = LS.config.grenade.throwCost;
    const myTurn = team === LS.state.activeTeam && !LS.state.busy && !LS.state.over;
    box.innerHTML = units.map(u => {
      const sel = LS.state.selectedId === u.id, dead = !u.alive;
      const hpFrac = u.hp / u.maxHp;
      const hpCol = hpFrac > 0.5 ? '#6bd86b' : hpFrac > 0.25 ? '#e0b13a' : '#ff5d5d';
      // state from AP: still able to react (>= fire cost), low (can move only), or spent.
      let stateCls = 'st-fresh', icon = '', word = '';
      if (dead) { stateCls = ''; }
      else if (u.ap < moveMin) { stateCls = 'st-spent'; icon = ICON_SPENT; word = ' — spent for the turn'; }
      else if (u.ap < fireCost) { stateCls = 'st-low'; word = ' — moved, too low to return fire'; }
      else if (u.ap < apMax) { stateCls = 'st-ready'; icon = ICON_EYE; word = ' — moved, still set for opportunity fire'; }
      const aria = dead ? `${u.name}: down`
        : `${u.name}: ${u.hp} of ${u.maxHp} health, ${u.ap} of ${apMax} action points, ${u.grenades} grenade${u.grenades === 1 ? '' : 's'}${word}`;
      const arming = LS.state.throwMode === u.id;
      const canThrow = myTurn && !dead && u.grenades > 0 && u.ap >= throwCost;
      const nade = dead ? '' :
        `<button class="sc-throw${arming ? ' arming' : ''}" data-throw="${u.id}" ${canThrow || arming ? '' : 'disabled'} title="Throw grenade — ${u.grenades} left, ${throwCost} AP" aria-label="${u.name}: ${arming ? 'cancel grenade throw' : 'throw grenade'}, ${u.grenades} left">${ICON_NADE}<span>${u.grenades}</span></button>`;
      return `<div class="squad-card ${team} ${stateCls} ${sel ? 'sel' : ''} ${dead ? 'dead' : ''}" data-id="${u.id}" role="button" tabindex="${dead ? -1 : 0}" aria-label="${aria}">
        <span class="sc-top"><span class="sc-name">${u.name}${dead ? ' ✕' : ''}</span><span class="sc-meta">${dead ? '' : icon}${nade}</span></span>
        <span class="sc-stat"><span class="sc-lbl">HP</span><span class="sc-bar"><i style="width:${dead ? 0 : Math.round(hpFrac * 100)}%;background:${hpCol}"></i></span><span class="sc-num">${dead ? '0' : u.hp}</span></span>
        <span class="sc-stat"><span class="sc-lbl">AP</span><span class="sc-bar"><i style="width:${dead ? 0 : Math.round(100 * u.ap / apMax)}%;background:#e6ad33"></i></span><span class="sc-num">${dead ? '0' : u.ap}</span></span>
      </div>`;
    }).join('');
  }

  return { update };
})();
