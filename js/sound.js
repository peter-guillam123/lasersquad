// sound.js — tiny synthesised SFX via Web Audio. No files; nothing to download.
// Off by default; the audio context is only created on a user gesture (browser autoplay rules).
LS.sound = (function () {
  let ctx = null, muted = true;

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { ctx = null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone({ freq, freqEnd, type = 'square', dur = 0.12, vol = 0.07, delay = 0 }) {
    if (muted || !ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.1, vol = 0.06 }) {
    if (muted || !ctx) return;
    const t0 = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(g); g.connect(ctx.destination); src.start(t0);
  }

  let stepFlip = false;
  function play(kind) {
    if (muted || !ctx) return;
    if (kind === 'step') { // soft footfall; alternates pitch so a walk reads as left-right
      stepFlip = !stepFlip;
      tone({ freq: stepFlip ? 98 : 80, freqEnd: 52, type: 'sine', dur: 0.07, vol: 0.05 });
      noise({ dur: 0.025, vol: 0.018 });
    }
    else if (kind === 'fire' || kind === 'fire_pistol') tone({ freq: 720, freqEnd: 170, type: 'square', dur: 0.14, vol: 0.06 }); // dry slug
    else if (kind === 'fire_laser') { // a clean high beam
      tone({ freq: 1500, freqEnd: 560, type: 'sine', dur: 0.17, vol: 0.05 });
      tone({ freq: 2300, freqEnd: 1100, type: 'triangle', dur: 0.09, vol: 0.022 });
    }
    else if (kind === 'fire_plasma') { // a heavy low blast with a crackle
      noise({ dur: 0.13, vol: 0.05 });
      tone({ freq: 300, freqEnd: 70, type: 'sawtooth', dur: 0.30, vol: 0.11 });
      tone({ freq: 620, freqEnd: 150, type: 'square', dur: 0.12, vol: 0.04 });
    }
    else if (kind === 'hit') { tone({ freq: 165, freqEnd: 60, type: 'sine', dur: 0.16, vol: 0.12 }); noise({ dur: 0.07, vol: 0.05 }); }
    else if (kind === 'miss') tone({ freq: 1150, freqEnd: 700, type: 'sine', dur: 0.07, vol: 0.04 });
    else if (kind === 'down') tone({ freq: 260, freqEnd: 70, type: 'sawtooth', dur: 0.42, vol: 0.1 });
    else if (kind === 'hurt') { // a short pained yelp when a soldier takes a hit
      tone({ freq: 400, freqEnd: 250, type: 'sawtooth', dur: 0.13, vol: 0.09 });
      noise({ dur: 0.05, vol: 0.022 });
    }
    else if (kind === 'death') { // a falling death cry — stylised (synth, no voice files)
      tone({ freq: 560, freqEnd: 110, type: 'sawtooth', dur: 0.5, vol: 0.12 });
      tone({ freq: 800, freqEnd: 180, type: 'square', dur: 0.4, vol: 0.035, delay: 0.05 });
      noise({ dur: 0.12, vol: 0.028 });
    }
    else if (kind === 'door') { tone({ freq: 120, freqEnd: 80, type: 'triangle', dur: 0.18, vol: 0.09 }); noise({ dur: 0.05, vol: 0.03 }); }
    else if (kind === 'glass') { noise({ dur: 0.18, vol: 0.07 }); tone({ freq: 2400, freqEnd: 1400, type: 'triangle', dur: 0.12, vol: 0.04 }); }
    else if (kind === 'throw') tone({ freq: 520, freqEnd: 900, type: 'sine', dur: 0.18, vol: 0.04 });
    else if (kind === 'boom') { noise({ dur: 0.4, vol: 0.16 }); tone({ freq: 90, freqEnd: 40, type: 'sawtooth', dur: 0.4, vol: 0.14 }); }
    else if (kind === 'contact') { // a two-note alert sting for spotting an enemy
      tone({ freq: 430, type: 'square', dur: 0.10, vol: 0.07 });
      tone({ freq: 700, type: 'square', dur: 0.13, vol: 0.07, delay: 0.11 });
    }
    else if (kind === 'endturn') { // a soft confirm chord when you hand the turn over
      tone({ freq: 300, freqEnd: 380, type: 'triangle', dur: 0.1, vol: 0.06 });
      tone({ freq: 480, type: 'sine', dur: 0.13, vol: 0.045, delay: 0.09 });
    }
    else if (kind === 'type') { // a quick typewriter clatter for an incoming log line
      for (let i = 0; i < 3; i++) tone({ freq: 1500 + (i % 2 ? 260 : 0), type: 'square', dur: 0.018, vol: 0.022, delay: i * 0.04 });
    }
    else if (kind === 'radio') { // a squelch of static + two beeps: a comms channel opening
      noise({ dur: 0.13, vol: 0.05 });
      tone({ freq: 920, type: 'square', dur: 0.045, vol: 0.035, delay: 0.02 });
      tone({ freq: 660, type: 'square', dur: 0.05, vol: 0.03, delay: 0.10 });
    }
    else if (kind === 'alarm') { // a two-tone klaxon wail — full combat alert
      for (let i = 0; i < 4; i++) tone({ freq: i % 2 ? 560 : 760, type: 'square', dur: 0.17, vol: 0.07, delay: i * 0.19 });
    }
  }

  // a spoken radio line via the browser's built-in speech synthesiser (no files, no network).
  // pitched down for a comms feel; respects the global mute. The actual voice is whatever the
  // machine has installed, so it varies a little computer-to-computer.
  function speak(text) {
    if (muted) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      synth.cancel(); // never let lines queue up on top of each other
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.pitch = 0.55; u.volume = 0.95;
      synth.speak(u);
    } catch (e) { /* speech not available — the banner still carries the message */ }
  }

  function toggle() { muted = !muted; if (!muted) ensure(); return muted; }
  function isMuted() { return muted; }

  return { ensure, play, speak, toggle, isMuted };
})();
