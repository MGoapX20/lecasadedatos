import type { DeviceKind } from '../input/input';
import type { Entry } from '../game/leaderboard';
import { formatClock, isRtl, t } from './i18n';
import type { Phase } from '../game/missions';

export type ScreenName = 'attract' | 'brief' | 'hud1' | 'hud2' | 'think' | 'results' | 'none';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

/** How long an item cue stays at full size before shrinking to a chip. */
const CUE_BIG_MS = 1500;

/** One offer on screen: what is here, and which key takes it. */
export interface Cue {
  /** Identity of the offer. A new key replays the entrance. */
  key: string;
  title: string;
  /** The key to press, if there is one. */
  press?: string;
  hint?: string;
  icon?: string;
  /** The offer is real but cannot be taken this instant. */
  waiting?: boolean;
}

/** Wire colours as CSS, matching the panel's `WireColor` names. */
const WIRE_COLORS: Record<string, string> = {
  red: '#e5323d',
  blue: '#3f8fe0',
  yellow: '#e8c33a',
  green: '#4fbf7a',
};

const GLYPHS: Record<DeviceKind, { label: string; round?: boolean }[]> = {
  keyboard: [{ label: 'SPACE' }],
  mouse: [{ label: 'SPACE' }],
  gamepad: [{ label: 'A', round: true }],
};

/** All DOM manipulation lives here; screens never touch the document directly. */
export class Overlay {
  private screens: Record<Exclude<ScreenName, 'none'>, HTMLElement>;
  private presenter = el('scr-presenter');
  private toastEl = el('toast');
  private cursorEl = el('cursor');
  private fadeEl = el('fade');
  private toastTimer = 0;
  private wireClick: ((index: number) => void) | null = null;
  private cueKey: string | null = null;
  private cueShownAt = 0;
  private seenObjectives = new Set<string>();
  private current: ScreenName = 'none';
  private presenterOpen = false;
  private menuOpen = false;

  readonly attractLine = el('attract-line');
  readonly attractGlyphs = el('attract-glyphs');
  readonly attractWanted = el('attract-wanted');
  readonly langToggle = el<HTMLButtonElement>('lang-toggle');
  readonly alarmButton = el<HTMLButtonElement>('h2-alarm-chip');

  constructor() {
    this.screens = {
      attract: el('scr-attract'),
      brief: el('scr-brief'),
      hud1: el('scr-hud1'),
      hud2: el('scr-hud2'),
      think: el('scr-think'),
      results: el('scr-results'),
    };
  }

  applyI18n(): void {
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((node) => {
      const key = node.dataset.i18n;
      if (key) node.textContent = t(key);
    });
    document.title = `${t('title.main')} — ${t('title.sub')}`;
  }

  /** A fresh visit forgets which objectives have already flashed. */
  resetMissions(): void {
    this.seenObjectives.clear();
  }

  show(name: ScreenName): void {
    if (this.current === name) return;
    for (const [key, node] of Object.entries(this.screens)) {
      node.classList.toggle('on', key === name);
    }
    this.current = name;
  }

  showPresenter(on: boolean): void {
    this.presenter.classList.toggle('on', on);
    this.presenterOpen = on;
    this.syncCursor();
  }

  /** The OS cursor is hidden during play and handed back for any real panel. */
  setMenuOpen(on: boolean): void {
    this.menuOpen = on;
    this.syncCursor();
  }

  private syncCursor(): void {
    document.documentElement.classList.toggle(
      'cursor-visible',
      this.presenterOpen || this.menuOpen,
    );
  }

  toast(message: string, ms = 2200): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }

  setCursor(x: number, y: number, visible: boolean): void {
    this.cursorEl.hidden = !visible;
    if (visible) {
      this.cursorEl.style.left = `${x}px`;
      this.cursorEl.style.top = `${y}px`;
    }
  }

  setGlyphs(container: HTMLElement, device: DeviceKind): void {
    container.textContent = '';
    for (const g of GLYPHS[device]) {
      const span = document.createElement('span');
      span.className = g.round ? 'glyph round' : 'glyph';
      span.textContent = g.label;
      container.appendChild(span);
    }
  }

  setWanted(board: Entry[]): void {
    const track = this.attractWanted;
    track.textContent = '';
    const rows = board.length
      ? board.slice(0, 8)
      : [{ codename: t('attract.empty'), heldMs: -1, breaches: 0, caught: 0, at: 0 }];
    // Duplicated so the marquee can loop seamlessly.
    for (let pass = 0; pass < 2; pass++) {
      rows.forEach((e, i) => {
        const span = document.createElement('span');
        span.className = i === 0 && e.heldMs >= 0 ? 'wanted-entry top' : 'wanted-entry';
        const rank = document.createElement('b');
        rank.className = 'rank';
        rank.textContent = e.heldMs >= 0 ? `${i + 1}` : '';
        span.appendChild(rank);
        span.append(
          e.heldMs >= 0 ? `${e.codename} — ${t('leaderboard.held')} ${formatClock(e.heldMs)}` : e.codename,
        );
        track.appendChild(span);
      });
    }
  }

  // ------------------------------------------------------------- briefings

  brief(opts: {
    title: string;
    body: string;
    controls: string;
    lines?: string[];
    codename?: string;
    tip?: string;
  }): void {
    el('brief-title').textContent = opts.title;
    el('brief-body').textContent = opts.body;
    const list = el('brief-lines');
    list.textContent = '';
    for (const line of opts.lines ?? []) {
      const li = document.createElement('li');
      li.textContent = line;
      list.appendChild(li);
    }
    el('brief-controls').textContent = opts.controls;
    const stamp = el('brief-codename');
    stamp.textContent = opts.codename ?? '';
    stamp.style.display = opts.codename ? '' : 'none';
    el('brief-tip').textContent = opts.tip ?? '';
  }

  // ------------------------------------------------------------------ HUDs

  hud1(opts: {
    codename: string;
    timeMs: number;
    caught: number;
    goal: string;
    banner: string | null;
    progress: { label: string; value: number; shape?: 'square' | 'circle' } | null;
    pick: {
      label: string;
      hint: string;
      zoneStart: number;
      zoneWidth: number;
      marker: number;
      pins: number;
      pinsSet: number;
      flash: 'hit' | 'miss' | null;
    } | null;
    missions: Phase[] | null;
    cue: Cue | null;
    wire: {
      label: string;
      hint: string;
      wires: { color: string; live: boolean; cut: boolean }[];
      cursor: number;
      phase: number;
      jammed: boolean;
      flash: 'cut' | 'short' | null;
    } | null;
    drill: {
      label: string;
      hint: string;
      heatLabel: string;
      progress: number;
      heat: number;
      jammed: boolean;
      biting: boolean;
    } | null;
    loads: { label: string; out: number; of: number } | null;
    prompt: string;
  }): void {
    el('h1-name').textContent = opts.codename;
    el('h1-time').textContent = formatClock(opts.timeMs);
    el('h1-caught').textContent = String(opts.caught);
    el('h1-goal').textContent = opts.goal;
    const banner = el('h1-banner');
    banner.textContent = opts.banner ?? '';
    banner.classList.toggle('show', !!opts.banner);
    const wrap = el('h1-progress-wrap');
    wrap.classList.toggle('show', !!opts.progress);
    wrap.dataset.shape = opts.progress?.shape ?? 'bar';
    if (opts.progress) {
      const fraction = Math.max(0, Math.min(1, opts.progress.value));
      const tunnel = el('h1-traversal');
      tunnel.style.setProperty('--remaining', String(100 * (1 - fraction)));
      tunnel.style.setProperty('--travel', String(-fraction * 160));
      wrap.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
      wrap.setAttribute('aria-label', opts.progress.label);
      el('h1-progress').style.setProperty('--p', `${Math.round(opts.progress.value * 100)}%`);
      el('h1-progress-label').textContent = opts.progress.label;
    }
    const pick = el('h1-pick');
    pick.classList.toggle('show', !!opts.pick);
    pick.classList.toggle('hit', opts.pick?.flash === 'hit');
    pick.classList.toggle('miss', opts.pick?.flash === 'miss');
    if (opts.pick) {
      el('h1-pick-label').textContent = opts.pick.label;
      el('h1-pick-hint').textContent = opts.pick.hint;
      const zone = el('h1-pick-zone');
      zone.style.insetInlineStart = `${opts.pick.zoneStart * 100}%`;
      zone.style.width = `${opts.pick.zoneWidth * 100}%`;
      el('h1-pick-marker').style.insetInlineStart = `${opts.pick.marker * 100}%`;
      const pins = el('h1-pick-pins');
      if (pins.children.length !== opts.pick.pins) {
        pins.textContent = '';
        for (let i = 0; i < opts.pick.pins; i++) pins.appendChild(document.createElement('i'));
      }
      Array.from(pins.children).forEach((node, i) =>
        node.classList.toggle('set', i < opts.pick!.pinsSet),
      );
    }
    this.renderMissions(opts.missions);
    this.renderCue(opts.cue);
    this.renderWire(opts.wire);
    this.renderDrill(opts.drill);
    this.renderLoads(opts.loads);
    el('h1-prompt').textContent = opts.prompt;
  }

  /** The phase board: heist on the left, the same move in security on the right. */
  private missionsVisible = false;
  private lastMissions: Phase[] | null = null;

  setMissionsVisible(visible: boolean): void {
    this.missionsVisible = visible;
    this.renderMissions(this.lastMissions);
  }

  private renderMissions(phases: Phase[] | null): void {
    this.lastMissions = phases;
    const panel = el('h1-missions');
    panel.classList.toggle('on', this.missionsVisible && !!phases);
    if (!this.missionsVisible || !phases) return;
    const list = el('h1-phases');
    if (list.children.length !== phases.length) {
      list.textContent = '';
      for (const p of phases) {
        const li = document.createElement('li');
        li.className = 'phase';
        li.innerHTML =
          `<span class="phase-head"><span class="phase-n"></span>` +
          `<span><span class="phase-name"></span><span class="phase-cyber"></span></span></span>` +
          `<ul class="objectives"></ul>`;
        list.appendChild(li);
      }
    }
    phases.forEach((p, i) => {
      const li = list.children[i] as HTMLElement;
      li.classList.toggle('active', p.active);
      li.classList.toggle('done', p.done);
      (li.querySelector('.phase-n') as HTMLElement).textContent = p.done ? '\u2713' : String(i + 1);
      (li.querySelector('.phase-name') as HTMLElement).textContent = t(p.labelKey);
      (li.querySelector('.phase-cyber') as HTMLElement).textContent = t(p.cyberKey);
      const ul = li.querySelector('.objectives') as HTMLElement;
      if (ul.children.length !== p.objectives.length) {
        ul.textContent = '';
        for (const _ of p.objectives) {
          const row = document.createElement('li');
          row.className = 'obj';
          row.innerHTML =
            '<span class="obj-tick"></span><span class="obj-a"></span><span class="obj-b"></span>';
          ul.appendChild(row);
        }
      }
      p.objectives.forEach((o, j) => {
        const row = ul.children[j] as HTMLElement;
        const hidden = o.state === 'hidden';
        row.classList.toggle('done', o.state === 'done');
        row.classList.toggle('hidden', hidden);
        // A newly found way in flashes once, then settles into the list.
        if (!hidden && !this.seenObjectives.has(o.id)) {
          this.seenObjectives.add(o.id);
          row.classList.remove('fresh');
          void row.offsetWidth;
          row.classList.add('fresh');
        }
        (row.querySelector('.obj-tick') as HTMLElement).textContent =
          o.state === 'done' ? '\u2713' : hidden ? '?' : '\u25CB';
        // A count beside the line, for the objectives that are a tally.
        (row.querySelector('.obj-a') as HTMLElement).textContent =
          hidden ? '\u2013 \u2013 \u2013' : o.note ? `${t(o.labelKey)}  ${o.note}` : t(o.labelKey);
        (row.querySelector('.obj-b') as HTMLElement).textContent = hidden ? '' : t(o.cyberKey);
      });
    });
  }

  /**
   * The item cue. It arrives at full size and shrinks to a chip after
   * `CUE_BIG_MS`, so it interrupts once and then gets out of the way. A new
   * `key` is a new offer and starts the sequence again.
   */
  private renderCue(cue: Cue | null): void {
    const node = el('h1-cue');
    if (!cue) {
      node.classList.remove('show', 'mini');
      this.cueKey = null;
      return;
    }
    if (cue.key !== this.cueKey) {
      this.cueKey = cue.key;
      this.cueShownAt = performance.now();
      node.classList.remove('mini');
      // Restart the entry animation for a genuinely new offer.
      node.classList.remove('show');
      void node.offsetWidth;
    }
    node.classList.add('show');
    node.classList.toggle('mini', performance.now() - this.cueShownAt > CUE_BIG_MS);
    node.classList.toggle('waiting', !!cue.waiting);
    el('h1-cue-icon').textContent = cue.icon ?? '';
    el('h1-cue-title').textContent = cue.title;
    el('h1-cue-key').textContent = cue.press ?? '';
    el('h1-cue-hint').textContent = cue.hint ?? '';
  }

  /** Called when the visitor clicks a wire rather than using the keys. */
  onWireClick(fn: (index: number) => void): void {
    this.wireClick = fn;
  }

  private renderWire(w: {
    label: string;
    hint: string;
    wires: { color: string; live: boolean; cut: boolean }[];
    cursor: number;
    phase: number;
    jammed: boolean;
    flash: 'cut' | 'short' | null;
  } | null): void {
    const wrap = el('h1-wire');
    wrap.classList.toggle('show', !!w);
    wrap.classList.toggle('cut', w?.flash === 'cut');
    wrap.classList.toggle('short', w?.flash === 'short');
    wrap.classList.toggle('jammed', !!w?.jammed);
    if (!w) return;
    el('h1-wire-label').textContent = w.label;
    el('h1-wire-hint').textContent = w.hint;
    const rows = el('h1-wire-rows');
    if (rows.children.length !== w.wires.length) {
      rows.textContent = '';
      w.wires.forEach((_, i) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'wire';
        row.innerHTML =
          '<span class="wire-tool">\u2702</span><span class="wire-end"></span>' +
          '<span class="wire-line"><span class="wire-half a"></span>' +
          '<span class="wire-half b"></span><span class="wire-spark"></span></span>' +
          '<span class="wire-end"></span>';
        // Named so it can be reached by keyboard and assistive tech, not just
        // by pointing at a coloured line.
        row.setAttribute('aria-label', `wire ${i + 1}`);
        row.addEventListener('click', () => this.wireClick?.(i));
        rows.appendChild(row);
      });
    }
    Array.from(rows.children).forEach((node, i) => {
      const row = node as HTMLElement;
      const wire = w.wires[i];
      row.style.setProperty('--w', WIRE_COLORS[wire.color] ?? '#888');
      row.classList.toggle('sel', i === w.cursor);
      row.classList.toggle('cut', wire.cut);
      // A wire reads as dead once it is cut, and an earth wire never carried
      // anything to begin with.
      row.classList.toggle('dead', wire.cut || !wire.live);
      const line = row.querySelector<HTMLElement>('.wire-line');
      // Each live wire is offset a little so the panel does not pulse in lockstep.
      if (line) line.style.setProperty('--p', String((w.phase + i * 0.17) % 1));
    });
  }

  /** The wall panel: cracks, depth, and how much noise the bit is making. */
  private renderDrill(d: {
    label: string;
    hint: string;
    heatLabel: string;
    progress: number;
    heat: number;
    jammed: boolean;
    biting: boolean;
  } | null): void {
    const wrap = el('h1-drill');
    wrap.classList.toggle('show', !!d);
    wrap.classList.toggle('on', !!d?.biting);
    wrap.classList.toggle('jammed', !!d?.jammed);
    wrap.classList.toggle('hot', !!d && !d.jammed && d.heat > 0.72);
    wrap.classList.toggle('through', !!d && d.progress >= 1);
    if (!d) return;
    el('h1-drill-label').textContent = d.label;
    el('h1-drill-hint').textContent = d.hint;
    el('h1-drill-heat-label').textContent = d.heatLabel;
    el('h1-drill-progress').style.width = `${Math.round(d.progress * 100)}%`;
    el('h1-drill-heat').style.width = `${Math.round(Math.min(1, d.heat) * 100)}%`;
    // The cracks open with the hole, each one a little behind the last.
    const cracks = el('h1-drill-wall').children;
    for (let i = 0; i < cracks.length; i++) {
      const k = Math.max(0, Math.min(1, d.progress * 1.35 - i * 0.12));
      (cracks[i] as HTMLElement).style.height = `${Math.round(k * 34)}px`;
    }
  }

  /** How much of the money is already in the van. */
  private renderLoads(l: { label: string; out: number; of: number } | null): void {
    const wrap = el('h1-loads');
    wrap.classList.toggle('show', !!l);
    if (!l) return;
    el('h1-loads-label').textContent = l.label;
    const pips = el('h1-loads-pips');
    if (pips.children.length !== l.of) {
      pips.textContent = '';
      for (let i = 0; i < l.of; i++) pips.appendChild(document.createElement('i'));
    }
    Array.from(pips.children).forEach((n, i) => n.classList.toggle('on', i < l.out));
  }

  hud2(opts: {
    codename: string;
    locks: number;
    alarm: string;
    alarmReady: boolean;
    breaches: number;
    caught: number;
    thieves: number;
    wave: string | null;
    banner: string | null;
    prompt: string;
  }): void {
    el('h2-name').textContent = opts.codename;
    el('h2-locks').textContent = String(opts.locks);
    el('h2-alarm').textContent = opts.alarm;
    this.alarmButton.classList.toggle('cooling', !opts.alarmReady);
    this.alarmButton.classList.toggle('armed', opts.alarmReady);
    this.alarmButton.disabled = !opts.alarmReady;
    el('h2-breaches').textContent = String(opts.breaches);
    el('h2-caught').textContent = String(opts.caught);
    el('h2-thieves').textContent = String(opts.thieves);
    const wave = el('h2-wave');
    wave.textContent = opts.wave ?? '';
    wave.classList.toggle('show', !!opts.wave);
    const banner = el('h2-banner');
    banner.textContent = opts.banner ?? '';
    banner.classList.toggle('show', !!opts.banner);
    el('h2-prompt').textContent = opts.prompt;
  }

  /** Edge arrow toward the vault while it is off screen in the follow camera. */
  /** What the arrow is pointing at, in words. */
  setObjectiveLabel(text: string): void {
    const node = el('h1-arrow').querySelector<HTMLElement>('.obj-label');
    if (node) {
      // Authored with data-i18n for the vault; once it is set here that has to
      // stop being reapplied on a language change, or it snaps back.
      delete node.dataset.i18n;
      node.textContent = text;
    }
  }

  private entranceIndicators: HTMLElement[] = [];
  setEntranceIndicators(points: { x: number; y: number; angleDeg: number }[], label = 'Entrance'): void {
    while (this.entranceIndicators.length < points.length) {
      const node = document.createElement('div'); node.className = 'entrance-indicator';
      node.setAttribute('aria-label', 'Entrance');
      node.innerHTML = '<span>➤</span>';
      el('scr-hud1').appendChild(node); this.entranceIndicators.push(node);
    }
    const placed: {x:number;y:number}[] = [];
    this.entranceIndicators.forEach((node,i) => {
      node.setAttribute('aria-label', label);
      const point = points[i]; node.hidden = !point;
      node.style.display = point ? 'grid' : 'none';
      if (!point) return;
      const bounds = node.parentElement!.getBoundingClientRect();
      const x = Math.max(24, Math.min(bounds.width - 24, point.x));
      let y = Math.max(85, Math.min(bounds.height - 75, point.y));
      // Keep nearby entrance directions independently readable.
      for (const other of placed) if (Math.abs(x-other.x)<30 && Math.abs(y-other.y)<30) y = Math.min(bounds.height-40,other.y+32);
      placed.push({x,y}); node.style.left = x+'px'; node.style.top = y+'px';
      node.firstElementChild!.setAttribute('style', 'transform:rotate('+point.angleDeg+'deg)');
    });
  }

  setObjectiveArrow(a: { x: number; y: number; angleDeg: number } | null): void {
    const node = el('h1-arrow');
    if (!a) {
      node.classList.remove('on');
      return;
    }
    node.classList.add('on');
    const halfWidth = node.offsetWidth / 2 + 12;
    const halfHeight = node.offsetHeight / 2 + 12;
    const bounds = node.parentElement!.getBoundingClientRect();
    node.style.left = `${Math.max(halfWidth, Math.min(bounds.width - halfWidth, a.x))}px`;
    node.style.top = `${Math.max(halfHeight + 65, Math.min(bounds.height - halfHeight - 55, a.y))}px`;
    el('h1-arrow-glyph').style.transform = `rotate(${a.angleDeg}deg)`;
  }

  /** The list of ways in: revealed one by one, then checked off as the swarm gets through. */
  setWays(
    items: { n: number; name: string; how: string; color: number; state: 'open' | 'breached' | 'held' }[] | null,
    title?: string,
  ): void {
    const panel = el('ways');
    if (!items) {
      panel.classList.remove('on');
      return;
    }
    panel.classList.add('on');
    if (title !== undefined) el('ways-title').textContent = title;
    const list = el('ways-list');
    list.classList.toggle('many', items.length > 10);
    // Rows are keyed by number so a reveal appends without re-animating the rest.
    const rows = Array.from(list.children) as HTMLElement[];
    while (rows.length > items.length) rows.pop()?.remove();
    items.forEach((it, i) => {
      let row = rows[i];
      if (!row) {
        row = document.createElement('li');
        row.className = 'way';
        row.innerHTML =
          '<span class="way-n"></span><span class="way-swatch"></span><span class="way-text"><span class="way-name"></span><span class="way-how"></span></span><span class="way-state"></span>';
        list.appendChild(row);
      }
      row.dataset.state = it.state;
      (row.querySelector('.way-n') as HTMLElement).textContent = String(it.n);
      (row.querySelector('.way-swatch') as HTMLElement).style.background = `#${it.color.toString(16).padStart(6, '0')}`;
      (row.querySelector('.way-name') as HTMLElement).textContent = it.name;
      (row.querySelector('.way-how') as HTMLElement).textContent = it.how;
      (row.querySelector('.way-state') as HTMLElement).textContent =
        it.state === 'breached' ? t('ways.breached') : it.state === 'held' ? t('ways.held') : '';
    });
  }

  /** The beat where the AI's routes fan out across the building. */
  think(opts: { ways: number; unit: string; clock: string; note?: string }): void {
    el('think-n').textContent = String(opts.ways);
    el('think-unit').textContent = opts.unit;
    el('think-clock').textContent = opts.clock;
    if (opts.note !== undefined) el('think-note').textContent = opts.note;
  }

  // --------------------------------------------------------------- results

  private resultTimers: number[] = [];
  private countRaf = 0;

  results(opts: {
    codename: string;
    youWays: number;
    youSub: string;
    aiWays: number;
    aiSub: string;
    aiSub2: string;
    ratio: string;
    held: string;
    lines: string[];
    /** Fired the moment the AI's number lands, for the shake and the hit. */
    onLand?: () => void;
  }): void {
    for (const id of this.resultTimers) clearTimeout(id);
    this.resultTimers = [];
    cancelAnimationFrame(this.countRaf);
    // The results screen addresses the visitor by the name it gave them.
    const youLabel = document.querySelector<HTMLElement>('.side.you .side-label');
    if (youLabel) youLabel.textContent = opts.codename;
    el('res-you-n').textContent = String(opts.youWays);
    el('res-you-sub').textContent = opts.youSub;
    const aiNum = el('res-ai-n');
    aiNum.textContent = '0';
    el('res-ai-sub').textContent = opts.aiSub;
    el('res-ai-sub2').textContent = opts.aiSub2;
    el('res-ratio').textContent = opts.ratio;
    el('res-held').textContent = opts.held;
    const list = el('res-translate');
    list.textContent = '';
    opts.lines.forEach((line, i) => {
      const li = document.createElement('li');
      li.textContent = line;
      li.style.setProperty('--i', String(i));
      list.appendChild(li);
    });

    // Restart the beat sequence from the top, even if the screen was just shown.
    const screen = this.screens.results;
    const aiSide = document.querySelector<HTMLElement>('.side.ai');
    screen.classList.remove('play');
    aiSide?.classList.remove('landed');
    void screen.offsetWidth;
    screen.classList.add('play');

    // The AI's number counts up as it lands, timed to the CSS punch-in.
    this.resultTimers.push(
      window.setTimeout(() => {
        opts.onLand?.();
        const start = performance.now();
        const dur = 850;
        const tick = (now: number) => {
          const k = Math.min(1, (now - start) / dur);
          const e = 1 - Math.pow(1 - k, 3);
          aiNum.textContent = String(Math.round(e * opts.aiWays));
          if (k < 1) this.countRaf = requestAnimationFrame(tick);
          else aiSide?.classList.add('landed');
        };
        this.countRaf = requestAnimationFrame(tick);
      }, 2050),
    );
  }

  get rtl(): boolean {
    return isRtl();
  }
}
