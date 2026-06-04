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
      card.innerHTML = `
        <div class="unit-name ${u.team}">${u.name}</div>
        <div class="stat"><span>Health</span><div class="bar"><i style="width:${100 * u.hp / u.maxHp}%;background:${u.hp / u.maxHp > 0.4 ? '#6bd86b' : '#e0b13a'}"></i></div><b>${u.hp}/${u.maxHp}</b></div>
        <div class="stat"><span>Action</span><div class="bar"><i style="width:${100 * u.ap / LS.config.ap.max}%;background:#4aa3ff"></i></div><b>${u.ap}/${LS.config.ap.max}</b></div>
        <div class="weapon">${w.name} · fire ${w.fireCost} AP · dmg ${w.dmgMin}–${w.dmgMax}</div>`;
    } else {
      card.innerHTML = `<div class="hint">Select one of your soldiers.</div>`;
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
  }

  function renderRoster(elId, team) {
    const box = document.getElementById(elId);
    const known = team === LS.state.activeTeam;   // fog: you only know your own squad's state
    box.innerHTML = LS.state.units.filter(u => u.team === team).map(u => {
      if (!known) return `<div class="pip ${team} unknown" title="enemy">?</div>`;
      const cls = !u.alive ? 'dead' : (LS.state.selectedId === u.id ? 'sel' : '');
      const hp = u.alive ? `${u.hp}` : '✕';
      return `<div class="pip ${team} ${cls}" data-id="${u.id}" title="${u.name}">${hp}</div>`;
    }).join('');
  }

  return { update };
})();
