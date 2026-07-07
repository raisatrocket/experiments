/* ============================================================
   The Lawn Club — synthesized sound
   Everything here is conjured with the Web Audio API:
   ball strikes, bounces, net cords, a politely hushed crowd,
   birdsong and a summer breeze. No audio files.
   ============================================================ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('lawn-muted') === '1';
    this._birdTimer = null;
  }

  /* Must be called from a user gesture (autoplay policy). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();

      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);

      this.crowdBus = this.ctx.createGain();
      this.crowdBus.gain.value = 1;
      this.crowdBus.connect(this.master);

      this.noiseBuf = this._makeNoise(2.0);
      this._startAmbience();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('lawn-muted', m ? '1' : '0');
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.3);
    }
  }

  /* ---------- building blocks ---------- */

  _makeNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noiseSource(loop = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = loop;
    return src;
  }

  _env(gainNode, t, attack, peak, decay) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    g.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /* ---------- continuous ambience ---------- */

  _startAmbience() {
    const ctx = this.ctx;

    // Crowd murmur — dark filtered noise, barely there, slowly breathing.
    const murmur = this._noiseSource(true);
    const mFilter = ctx.createBiquadFilter();
    mFilter.type = 'lowpass';
    mFilter.frequency.value = 420;
    mFilter.Q.value = 0.4;
    this.murmurGain = ctx.createGain();
    this.murmurGain.gain.value = 0.028;
    const mLfo = ctx.createOscillator();
    mLfo.frequency.value = 0.07;
    const mLfoGain = ctx.createGain();
    mLfoGain.gain.value = 0.008;
    mLfo.connect(mLfoGain).connect(this.murmurGain.gain);
    murmur.connect(mFilter).connect(this.murmurGain).connect(this.crowdBus);
    murmur.start();
    mLfo.start();

    // Breeze — soft low noise with a slow wandering filter.
    const breeze = this._noiseSource(true);
    const bFilter = ctx.createBiquadFilter();
    bFilter.type = 'lowpass';
    bFilter.frequency.value = 300;
    const bLfo = ctx.createOscillator();
    bLfo.frequency.value = 0.05;
    const bLfoGain = ctx.createGain();
    bLfoGain.gain.value = 160;
    bLfo.connect(bLfoGain).connect(bFilter.frequency);
    const bGain = ctx.createGain();
    bGain.gain.value = 0.02;
    const bgLfo = ctx.createOscillator();
    bgLfo.frequency.value = 0.09;
    const bgLfoGain = ctx.createGain();
    bgLfoGain.gain.value = 0.009;
    bgLfo.connect(bgLfoGain).connect(bGain.gain);
    breeze.connect(bFilter).connect(bGain).connect(this.master);
    breeze.start();
    bLfo.start();
    bgLfo.start();

    this._scheduleBird();
  }

  _scheduleBird() {
    clearTimeout(this._birdTimer);
    const next = 2500 + Math.random() * 9000;
    this._birdTimer = setTimeout(() => {
      if (this.ctx && this.ctx.state === 'running') this._birdPhrase();
      this._scheduleBird();
    }, next);
  }

  _birdPhrase() {
    const ctx = this.ctx;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (pan.pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.master);

    const notes = 2 + Math.floor(Math.random() * 4);
    const f0 = 2500 + Math.random() * 1800;
    let t = ctx.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const fStart = f0 * (0.92 + Math.random() * 0.22);
      osc.frequency.setValueAtTime(fStart, t);
      osc.frequency.exponentialRampToValueAtTime(fStart * (0.68 + Math.random() * 0.2), t + 0.07);
      const g = ctx.createGain();
      this._env(g, t, 0.008, 0.028 + Math.random() * 0.014, 0.07);
      osc.connect(g).connect(pan);
      osc.start(t);
      osc.stop(t + 0.12);
      t += 0.08 + Math.random() * 0.07;
    }
  }

  /* ---------- gameplay one-shots ---------- */

  hit(power = 0.5, spin = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // low thump of the strings
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170 + 60 * power, t);
    osc.frequency.exponentialRampToValueAtTime(65, t + 0.09);
    const og = ctx.createGain();
    this._env(og, t, 0.004, 0.28 + 0.3 * power, 0.1);
    osc.connect(og).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.16);

    // "pock" — filtered noise snap; slice sounds brushier
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1400 + 2200 * power + (spin < 0 ? 900 : 0);
    f.Q.value = spin < 0 ? 0.8 : 1.6;
    const ng = ctx.createGain();
    this._env(ng, t, 0.002, 0.16 + 0.34 * power, 0.05);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.08);
  }

  bounce(soft = false) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(soft ? 110 : 140, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.08);
    const g = ctx.createGain();
    this._env(g, t, 0.003, soft ? 0.1 : 0.17, 0.09);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  netCord() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.12);
    const g = ctx.createGain();
    this._env(g, t, 0.004, 0.22, 0.14);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);

    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 1.2;
    const ng = ctx.createGain();
    this._env(ng, t, 0.003, 0.1, 0.12);
    n.connect(f).connect(ng).connect(this.master);
    n.start(t);
    n.stop(t + 0.16);
  }

  swoosh(power = 0.6) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1800 + 1200 * power, t + 0.1);
    f.Q.value = 1.4;
    const g = ctx.createGain();
    this._env(g, t, 0.03, 0.04 + 0.05 * power, 0.12);
    n.connect(f).connect(g).connect(this.master);
    n.start(t);
    n.stop(t + 0.2);
  }

  /* Polite applause — a cloud of little clap grains. intensity 0..1 */
  applause(intensity = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + 0.15;
    const dur = 1.3 + 1.9 * intensity;
    const claps = Math.floor(45 + 130 * intensity);

    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.gain.linearRampToValueAtTime(1, now + dur * 0.25);
    bus.gain.setValueAtTime(1, now + dur * 0.6);
    bus.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    bus.connect(this.crowdBus);

    for (let i = 0; i < claps; i++) {
      const t = now + Math.pow(Math.random(), 0.8) * dur;
      const src = this._noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 2600;
      f.Q.value = 2.5;
      const g = ctx.createGain();
      this._env(g, t, 0.002, 0.015 + Math.random() * 0.03, 0.03);
      let out = g;
      if (ctx.createStereoPanner) {
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 1.7 - 0.85;
        g.connect(pan);
        out = pan;
      }
      src.connect(f).connect(g);
      out.connect(bus);
      src.start(t);
      src.stop(t + 0.05);
    }

    // murmur swells with the applause
    const mg = this.murmurGain.gain;
    const t0 = ctx.currentTime;
    mg.cancelScheduledValues(t0);
    mg.setValueAtTime(mg.value, t0);
    mg.linearRampToValueAtTime(0.05, t0 + 0.4);
    mg.linearRampToValueAtTime(0.028, t0 + dur + 0.8);
  }

  /* A soft disappointed "ohh" from the crowd (faults, nets). */
  aww() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.08;
    const n = this._noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(380, t);
    f.frequency.linearRampToValueAtTime(240, t + 0.7);
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(f).connect(g).connect(this.crowdBus);
    n.start(t);
    n.stop(t + 1);
  }

  /* The crowd holds its breath for a serve. */
  hush() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mg = this.murmurGain.gain;
    mg.cancelScheduledValues(t);
    mg.setValueAtTime(mg.value, t);
    mg.linearRampToValueAtTime(0.012, t + 0.6);
    mg.linearRampToValueAtTime(0.028, t + 5);
  }
}
