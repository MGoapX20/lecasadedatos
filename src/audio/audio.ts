import { config } from '../config';

export type Sfx =
  | 'blip'
  | 'confirm'
  | 'deny'
  | 'step'
  | 'lockpick'
  | 'unlock'
  | 'alarm'
  | 'caught'
  | 'printer'
  | 'breach'
  | 'spotted'
  | 'power'
  | 'snip'
  | 'zap'
  | 'whoosh';

/**
 * All sound is synthesised, so the game ships with no audio files and still
 * works. If a music track is dropped into public/audio it is used instead of
 * the built-in loop.
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private musicSource: AudioBufferSourceNode | OscillatorNode | null = null;
  private musicNodes: AudioNode[] = [];
  private alarmOsc: OscillatorNode | null = null;
  private lastStep = 0;
  private unlocked = false;
  private trackUrl: string | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** Requested before the browser would allow sound; started as soon as it will. */
  private pendingUrl: string | null = null;
  private pendingVolume = 1;
  private loading = new Map<string, Promise<AudioBuffer | null>>();

  /**
   * Build the audio graph and decode the music up front. Browsers allow a
   * context to exist before the visitor touches anything, it simply starts
   * suspended, so doing the slow work now means the first gesture only has to
   * resume and the theme is audible immediately rather than seconds later.
   */
  preload(urls: string[]): void {
    this.ensureGraph();
    for (const url of urls) void this.load(url);
  }

  private async load(url: string): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const cached = this.buffers.get(url);
    if (cached) return cached;
    const inflight = this.loading.get(url);
    if (inflight) return inflight;
    const job = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(url, buf);
        return buf;
      } catch {
        return null;
      } finally {
        this.loading.delete(url);
      }
    })();
    this.loading.set(url, job);
    return job;
  }

  private ensureGraph(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = config.sfxVolume;
      this.sfxGain.connect(this.master);
    } catch {
      return false;
    }
    return true;
  }

  unlock(): void {
    if (!this.ensureGraph() || !this.ctx) return;
    this.unlocked = true;
    void this.ctx.resume();
    // Anything asked for while sound was still blocked starts now.
    if (this.pendingUrl) {
      const url = this.pendingUrl;
      this.pendingUrl = null;
      void this.startMusic(url, this.pendingVolume);
    }
  }

  resume(): void {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    if (this.unlocked && this.pendingUrl) {
      const url = this.pendingUrl;
      this.pendingUrl = null;
      void this.startMusic(url, this.pendingVolume);
    }
  }

  /**
   * Ask for a track. Browsers refuse to make noise before the visitor has
   * touched something, so a request made too early is remembered and starts
   * the instant sound is allowed, wherever the visitor happens to be.
   */
  requestMusic(url: string, volume = config.musicVolume): void {
    if (!this.unlocked || !this.ctx) {
      this.pendingUrl = url;
      this.pendingVolume = volume;
      return;
    }
    void this.startMusic(url, volume);
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    sweepTo?: number,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    o.connect(g);
    g.connect(this.sfxGain);
    o.start(t);
    o.stop(t + duration + 0.02);
  }

  private noise(duration: number, gain: number, hp = 800): void {
    if (!this.ctx || !this.sfxGain) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfxGain);
    src.start(t);
  }

  play(id: Sfx): void {
    if (!this.unlocked) return;
    switch (id) {
      case 'blip':
        this.tone(660, 0.07, 'square', 0.06);
        break;
      case 'confirm':
        this.tone(520, 0.09, 'triangle', 0.1);
        this.tone(780, 0.12, 'triangle', 0.07);
        break;
      case 'deny':
        this.tone(180, 0.16, 'sawtooth', 0.08, 90);
        break;
      case 'step': {
        const now = performance.now();
        if (now - this.lastStep < 190) return;
        this.lastStep = now;
        this.noise(0.05, 0.045, 1400);
        break;
      }
      case 'lockpick':
        this.tone(2100 + Math.random() * 500, 0.03, 'square', 0.035);
        break;
      case 'unlock':
        this.tone(320, 0.1, 'square', 0.09);
        this.tone(640, 0.16, 'triangle', 0.08);
        break;
      case 'alarm':
        this.tone(880, 0.35, 'sawtooth', 0.13, 440);
        break;
      case 'caught':
        this.tone(240, 0.3, 'sawtooth', 0.13, 70);
        this.noise(0.22, 0.07, 300);
        break;
      case 'printer':
        this.noise(0.16, 0.05, 2200);
        this.tone(150, 0.14, 'square', 0.05);
        break;
      case 'breach':
        this.tone(160, 0.9, 'sawtooth', 0.16, 1100);
        this.noise(0.7, 0.12, 500);
        break;
      case 'spotted':
        this.tone(420, 0.1, 'square', 0.1, 980);
        this.tone(980, 0.22, 'square', 0.08);
        break;
      case 'snip':
        // Two quick metal edges meeting.
        this.tone(2600, 0.02, 'square', 0.05);
        this.tone(1700, 0.04, 'square', 0.04);
        break;
      case 'zap':
        this.noise(0.18, 0.11, 2600);
        this.tone(140, 0.22, 'sawtooth', 0.12, 60);
        break;
      case 'power':
        this.tone(90, 0.5, 'sawtooth', 0.14, 30);
        this.noise(0.3, 0.1, 900);
        break;
      case 'whoosh':
        this.noise(0.42, 0.07, 260);
        break;
    }
  }

  /** Rising two-tone siren while the alarm window is open. */
  setAlarm(active: boolean): void {
    if (!this.ctx || !this.sfxGain) return;
    if (active && !this.alarmOsc) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = 620;
      lfo.frequency.value = 2.4;
      lfoGain.gain.value = 210;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      g.gain.value = 0.035 * config.sfxVolume;
      o.connect(g);
      g.connect(this.sfxGain);
      o.start();
      lfo.start();
      this.alarmOsc = o;
      this.musicNodes.push(lfo, lfoGain, g);
    } else if (!active && this.alarmOsc) {
      this.alarmOsc.stop();
      this.alarmOsc = null;
    }
  }

  get isUnlocked(): boolean {
    return this.unlocked;
  }

  get currentTrack(): string | null {
    return this.trackUrl;
  }

  /** Try the supplied track; fall back to a built-in tense loop. */
  async startMusic(url: string, volume = config.musicVolume): Promise<void> {
    if (!this.ctx || !this.musicGain) {
      this.pendingUrl = url;
      this.pendingVolume = volume;
      return;
    }
    if (this.trackUrl === url && this.musicSource) {
      this.fadeMusic(volume, 0.8);
      return;
    }
    this.stopMusic();
    this.trackUrl = url;
    const buf = await this.load(url);
    if (buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(this.musicGain);
      src.start();
      this.musicSource = src;
    } else {
      this.startSynthLoop();
    }
    this.fadeMusic(volume, 2.2);
  }

  private startSynthLoop(): void {
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    // A slow minor pulse; enough atmosphere to carry the attract screen.
    const notes = [110, 130.81, 164.81, 130.81];
    const gain = this.ctx.createGain();
    gain.gain.value = 0.5;
    gain.connect(this.musicGain);
    for (let i = 0; i < 16; i++) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = notes[i % notes.length] * (i % 8 < 4 ? 1 : 1.5);
      const start = t + i * 1.5;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.12, start + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 1.45);
      o.connect(g);
      g.connect(gain);
      o.start(start);
      o.stop(start + 1.5);
      this.musicNodes.push(o, g);
    }
    const pad = this.ctx.createOscillator();
    const padGain = this.ctx.createGain();
    pad.type = 'sine';
    pad.frequency.value = 55;
    padGain.gain.value = 0.09;
    pad.connect(padGain);
    padGain.connect(gain);
    pad.start();
    this.musicSource = pad;
    this.musicNodes.push(padGain);
    // Loop the sequence.
    window.setTimeout(() => {
      if (this.musicSource === pad) this.startSynthLoop();
    }, 24000);
  }

  fadeMusic(to: number, seconds = 1): void {
    if (!this.ctx || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(t);
    this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), t);
    this.musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, to), t + seconds);
  }

  stopMusic(): void {
    this.trackUrl = null;
    try {
      this.musicSource?.stop();
    } catch {
      /* already stopped */
    }
    this.musicSource = null;
    for (const n of this.musicNodes) {
      try {
        (n as OscillatorNode).stop?.();
      } catch {
        /* not a source */
      }
    }
    this.musicNodes = [];
  }
}
