// ui.js — the HTML panels around the board: turn banner, selected-unit card, log, victory.
LS.ui = (function () {
  function update() {
    const s = LS.state;
    // turn banner
    const banner = document.getElementById('turn-banner');
    banner.textContent = s.over ? 'GAME OVER' : `${s.activeTeam.toUpperCase()} turn`;
    banner.className = 'turn-banner ' + (s.over ? 'over' : s.activeTeam);

    // selected unit card
    const card = document.getElementById('unit-card');
    const u = LS.game.selected();
    if (u) {
      const w = LS.level.weapon;
      // HP/AP now live in the squad strip above; the card carries the selected soldier's kit
      card.innerHTML = `
        <div class="unit-name ${u.team}">${u.name}</div>
        <div class="weapon bare">${w.name} · fire ${w.fireCost} AP · dmg ${w.dmgMin}–${w.dmgMax} · range ${w.range}<br>Grenades: ${u.grenades} · throw ${LS.config.grenade.throwCost} AP</div>`;
    } else {
      card.innerHTML = `<div class="hint">Select one of your soldiers.</div>`;
    }

    // throw-grenade button (contextual to the selected soldier)
    const tb = document.getElementById('throw-btn');
    if (u && u.team === s.activeTeam && !s.over) {
      tb.style.display = '';
      if (s.throwMode) {
        tb.textContent = 'Cancel throw'; tb.disabled = false; tb.classList.add('arming');
      } else {
        tb.classList.remove('arming');
        tb.textContent = `Throw grenade (${u.grenades})`;
        tb.disabled = s.busy || u.grenades <= 0 || u.ap < LS.config.grenade.throwCost;
      }
    } else {
      tb.style.display = 'none';
    }

    // log
    const log = document.getElementById('log');
    log.innerHTML = s.log.slice(-9).map(m => `<div>${m}</div>`).join('');
    log.scrollTop = log.scrollHeight;

    // squad rosters
    renderRoster('roster-blue', 'blue');
    renderRoster('roster-red', 'red');

    // pass-the-device handoff screen
    const ho = document.getElementById('handoff');
    if (s.handoff && !s.over) {
      ho.style.display = 'flex';
      const t = ho.querySelector('.handoff-team');
      t.textContent = s.activeTeam.toUpperCase();
      t.className = 'handoff-team ' + s.activeTeam;
    } else {
      ho.style.display = 'none';
    }

    // victory overlay
    const ov = document.getElementById('overlay');
    if (s.over) {
      ov.style.display = 'flex';
      ov.querySelector('.win-text').textContent = `${s.winner.toUpperCase()} squad wins`;
      ov.querySelector('.win-text').className = 'win-text ' + s.winner;
    } else {
      ov.style.display = 'none';
    }

    document.getElementById('end-turn').disabled = s.over || s.busy;

    const mb = document.getElementById('mute');
    if (mb) mb.textContent = 'Sound: ' + (LS.sound.isMuted() ? 'off' : 'on');
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

    // your squad: a card each with name, HP, AP and grenades, always on view
    box.className = 'roster squad';
    const apMax = LS.config.ap.max;
    box.innerHTML = units.map(u => {
      const sel = LS.state.selectedId === u.id, dead = !u.alive;
      const hpFrac = u.hp / u.maxHp;
      const hpCol = hpFrac > 0.5 ? '#6bd86b' : hpFrac > 0.25 ? '#e0b13a' : '#ff5d5d';
      const aria = dead ? `${u.name}: down`
        : `${u.name}: ${u.hp} of ${u.maxHp} health, ${u.ap} of ${apMax} action points, ${u.grenades} grenade${u.grenades === 1 ? '' : 's'}`;
      const nades = u.grenades > 0 ? '◍'.repeat(u.grenades) : '·';
      return `<button class="squad-card ${team} ${sel ? 'sel' : ''} ${dead ? 'dead' : ''}" data-id="${u.id}" ${dead ? 'disabled' : ''} aria-label="${aria}">
        <span class="sc-top"><span class="sc-name">${u.name}${dead ? ' ✕' : ''}</span><span class="sc-nades" aria-hidden="true">${dead ? '' : nades}</span></span>
        <span class="sc-stat"><span class="sc-lbl">HP</span><span class="sc-bar"><i style="width:${dead ? 0 : Math.round(hpFrac * 100)}%;background:${hpCol}"></i></span><span class="sc-num">${dead ? '0' : u.hp}</span></span>
        <span class="sc-stat"><span class="sc-lbl">AP</span><span class="sc-bar"><i style="width:${dead ? 0 : Math.round(100 * u.ap / apMax)}%;background:#4aa3ff"></i></span><span class="sc-num">${dead ? '0' : u.ap}</span></span>
      </button>`;
    }).join('');
  }

  return { update };
})();
