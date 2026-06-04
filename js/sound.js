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

  function play(kind) {
    if (muted || !ctx) return;
    if (kind === 'fire') tone({ freq: 720, freqEnd: 170, type: 'square', dur: 0.14, vol: 0.06 });
    else if (kind === 'hit') { tone({ freq: 165, freqEnd: 60, type: 'sine', dur: 0.16, vol: 0.12 }); noise({ dur: 0.07, vol: 0.05 }); }
    else if (kind === 'miss') tone({ freq: 1150, freqEnd: 700, type: 'sine', dur: 0.07, vol: 0.04 });
    else if (kind === 'down') tone({ freq: 260, freqEnd: 70, type: 'sawtooth', dur: 0.42, vol: 0.1 });
    else if (kind === 'door') { tone({ freq: 120, freqEnd: 80, type: 'triangle', dur: 0.18, vol: 0.09 }); noise({ dur: 0.05, vol: 0.03 }); }
    else if (kind === 'glass') { noise({ dur: 0.18, vol: 0.07 }); tone({ freq: 2400, freqEnd: 1400, type: 'triangle', dur: 0.12, vol: 0.04 }); }
    else if (kind === 'throw') tone({ freq: 520, freqEnd: 900, type: 'sine', dur: 0.18, vol: 0.04 });
    else if (kind === 'boom') { noise({ dur: 0.4, vol: 0.16 }); tone({ freq: 90, freqEnd: 40, type: 'sawtooth', dur: 0.4, vol: 0.14 }); }
  }

  function toggle() { muted = !muted; if (!muted) ensure(); return muted; }
  function isMuted() { return muted; }

  return { ensure, play, toggle, isMuted };
})();
