import type { Level } from '../level/loader';
import type { CellXY } from '../level/schema';
import type { SimEvent } from '../sim/events';
import type { SimWorld, Thief } from '../sim/world';

/**
 * The briefing, in two languages at once: what a thief is doing, and what the
 * same move is called when it happens to a network. This is the exhibit's whole
 * argument, so it runs alongside the play rather than waiting for the results
 * screen.
 *
 * Four phases in the order an intrusion actually goes: look at the building,
 * get a foot inside, move around once you are in, and take something out. The
 * ways in are not listed up front on purpose. You have to walk the perimeter to
 * find them, which is the reconnaissance the phase is named after.
 *
 * The last phase is the one that matters most and is usually the one nobody
 * pictures: standing in the vault is not the robbery. The robbery is the money
 * leaving the building, and until it does, the alarm can still win.
 */
export type PhaseId = 'recon' | 'foothold' | 'lateral' | 'exfil';

export type ObjectiveState = 'hidden' | 'open' | 'done';

export interface Objective {
  id: string;
  /** What the thief does. */
  labelKey: string;
  /** What it is called in security. */
  cyberKey: string;
  state: ObjectiveState;
  /** Found by walking near it, rather than listed from the start. */
  discoverable: boolean;
  /** A count or similar, shown beside the line. */
  note?: string;
  /**
   * The thing in the building this line is about, if it is a thing. The
   * renderer outlines these for whichever phase is active, so the board and the
   * building cannot drift apart. It names what, not where: a door that swings
   * or a lorry on its round carries its own highlight.
   */
  mark?: MarkRef;
}

/** A thing in the building, named the way the level names it. */
export type MarkRef =
  | { kind: 'door'; id: string }
  | { kind: 'portal'; id: string }
  | { kind: 'key'; index: number }
  | { kind: 'truck' }
  | { kind: 'van' }
  | { kind: 'breachWall' }
  | { kind: 'press'; cell: CellXY };

export interface Phase {
  id: PhaseId;
  labelKey: string;
  cyberKey: string;
  objectives: Objective[];
  done: boolean;
  active: boolean;
}

/** How close the thief has to get before a way in is on the list. */
const DISCOVER_CELLS = 9;
/** Sides of the perimeter that count as having walked round. */
const SIDES_FOR_RECON = 3;
/** Ways in that have to be on the list before the recon is called done. */
const WAYS_FOR_RECON = 5;

interface FootholdSpec {
  id: string;
  labelKey: string;
  cyberKey: string;
  /** Where the thief has to get to for this to appear. */
  anchor: (level: Level, world: SimWorld) => { x: number; y: number } | null;
  /** What to outline in the building once it has been found. */
  mark: MarkRef;
}



function entryAnchor(entryId: string) {
  return (level: Level) => {
    const e = level.json.entries.find((x) => x.id === entryId);
    return e ? { x: e.spawn[0] + 0.5, y: e.spawn[1] + 0.5 } : null;
  };
}

/**
 * The ways in, each with the technique it stands for. A sewer nobody knew was
 * there is a 0-day; a lock you can pick is a vulnerability with a patch
 * already published; the supplier's lorry is somebody else's trust, borrowed.
 */
const FOOTHOLDS: FootholdSpec[] = [
  {
    id: 'foothold.front',
    labelKey: 'missions.front',
    cyberKey: 'cyber.phishing',
    anchor: entryAnchor('front'),
    mark: { kind: 'door', id: 'd_front' },
  },
  {
    id: 'foothold.side',
    labelKey: 'missions.side',
    cyberKey: 'cyber.oneDay',
    anchor: entryAnchor('side'),
    mark: { kind: 'door', id: 'd_side' },
  },
  {
    id: 'foothold.dock',
    labelKey: 'missions.dock',
    cyberKey: 'cyber.supplyChain',
    // Found by seeing the lorry, wherever it happens to be on its round.
    anchor: (_level, world) => ({ x: world.truck.x, y: world.truck.y }),
    mark: { kind: 'truck' },
  },
  {
    id: 'foothold.vent',
    labelKey: 'missions.vent',
    cyberKey: 'cyber.unpatched',
    anchor: entryAnchor('vent'),
    mark: { kind: 'portal', id: 'p_vent' },
  },
  {
    id: 'foothold.sewer',
    labelKey: 'missions.sewer',
    cyberKey: 'cyber.zeroDay',
    anchor: entryAnchor('sewer'),
    mark: { kind: 'portal', id: 'p_sewer' },
  },
];

const EXFIL: { id: string; labelKey: string; cyberKey: string }[] = [
  { id: 'exfil.hole', labelKey: 'missions.hole', cyberKey: 'cyber.channel' },
  { id: 'exfil.van', labelKey: 'missions.van', cyberKey: 'cyber.stagingServer' },
  { id: 'exfil.load', labelKey: 'missions.load', cyberKey: 'cyber.exfiltrate' },
];

const LATERAL: { id: string; labelKey: string; cyberKey: string }[] = [
  { id: 'lateral.power', labelKey: 'missions.power', cyberKey: 'cyber.disableAv' },
  { id: 'lateral.uniform', labelKey: 'missions.uniform', cyberKey: 'cyber.evadeAv' },
  { id: 'lateral.card', labelKey: 'missions.card', cyberKey: 'cyber.credentials' },
  { id: 'lateral.vault', labelKey: 'missions.vault', cyberKey: 'cyber.crownJewels' },
];

export class MissionTracker {
  private discovered = new Set<string>();
  private announced = new Set<string>();
  private cached: Phase[] = [];
  private done = new Set<string>();
  private sides = new Set<string>();
  /** Which way in was actually used, once the thief is inside. */
  private usedEntry: string | null = null;
  private insideSeen = false;
  /** The vault has been stood in, which is where getting it out begins. */
  private vaultSeen = false;
  /** The world the board was last built from; the exfil lines read live state. */
  private world: SimWorld | null = null;
  private level: Level | null = null;

  reset(): void {
    this.discovered.clear();
    this.done.clear();
    this.sides.clear();
    this.usedEntry = null;
    this.insideSeen = false;
    this.vaultSeen = false;
    this.world = null;
    this.level = null;
    this.announced.clear();
    this.cached = [];
  }

  /** Events tell us which way in was taken; position alone cannot. */
  note(e: SimEvent): void {
    if (e.kind === 'portalExit') {
      if (e.portal === 'p_vent') this.usedEntry = 'foothold.vent';
      if (e.portal === 'p_sewer') this.usedEntry = 'foothold.sewer';
    } else if (e.kind === 'truckLeave' && e.inside) {
      this.usedEntry = 'foothold.dock';
    } else if (e.kind === 'lockpickEnd') {
      // Picking your way in is the side door's technique wherever you do it.
      this.discovered.add('foothold.side');
      if (!this.insideSeen) this.usedEntry = 'foothold.side';
    }
  }

  /**
   * Recompute the board. Returns the objectives that appeared on this call, so
   * the caller can make a noise about them.
   */
  update(world: SimWorld, level: Level, player: Thief | undefined): Objective[] {
    const revealed: Objective[] = [];
    this.world = world;
    this.level = level;
    if (player && !player.hidden) {
      this.markSide(level, player);
      for (const spec of FOOTHOLDS) {
        if (this.discovered.has(spec.id)) continue;
        const at = spec.anchor(level, world);
        if (!at) continue;
        if (Math.hypot(at.x - player.x, at.y - player.y) <= DISCOVER_CELLS) {
          this.discovered.add(spec.id);
        }
      }
    }

    const inside = !!player && level.indoor[this.cellOf(level, player)] === 1;
    if (inside && !this.insideSeen) {
      this.insideSeen = true;
      // Walked in through a door without picking anything: that is the front.
      if (!this.usedEntry) this.usedEntry = 'foothold.front';
    }
    if (this.usedEntry) {
      this.discovered.add(this.usedEntry);
      this.done.add(this.usedEntry);
    }

    if (player && !player.hidden) {
      const [rx, ry, rw, rh] = level.json.vault.rect;
      if (player.x >= rx && player.x < rx + rw && player.y >= ry && player.y < ry + rh) {
        this.vaultSeen = true;
      }
    }
    if (player) {
      if (world.camerasDown) this.done.add('lateral.power');
      if (world.isDisguised(player)) this.done.add('lateral.uniform');
      for (const k of level.json.keycards) {
        if ((k.kind ?? 'card') === 'card' && player.keys.has(k.id)) this.done.add('lateral.card');
      }
      if (player.breached) this.done.add('lateral.vault');
    }

    const phases = this.build();
    for (const p of phases) {
      for (const o of p.objectives) {
        if (o.state === 'hidden' || !o.discoverable || this.announced.has(o.id)) continue;
        this.announced.add(o.id);
        revealed.push(o);
      }
    }
    this.cached = phases;
    return revealed;
  }

  get phases(): Phase[] {
    return this.cached.length ? this.cached : this.build();
  }

  /** The phase the visitor should be looking at. */
  get activePhase(): Phase | null {
    return this.phases.find((p) => p.active) ?? null;
  }

  /**
   * What to outline in the building for the phase in hand. During recon the
   * active section names nothing — circling a building is not a thing you can
   * point at — so it falls through to the ways in that have actually been
   * found, which is what the walk is for.
   */
  get activeMarks(): MarkRef[] {
    const phases = this.phases;
    const from = (p: Phase | undefined) =>
      (p?.objectives ?? []).filter((o) => o.state === 'open' && o.mark).map((o) => o.mark!);
    const active = phases.find((p) => p.active);
    const mine = from(active);
    if (mine.length) return mine;
    const next = phases[phases.indexOf(active as Phase) + 1];
    return from(next);
  }

  private cellOf(level: Level, t: Thief): number {
    const x = Math.min(level.w - 1, Math.max(0, Math.floor(t.x)));
    const y = Math.min(level.h - 1, Math.max(0, Math.floor(t.y)));
    return y * level.w + x;
  }

  /** Which side of the building the thief is standing off, if any. */
  private markSide(level: Level, t: Thief): void {
    if (level.indoor[this.cellOf(level, t)] === 1) return;
    const w = level.w;
    const h = level.h;
    if (t.y < h * 0.25) this.sides.add('n');
    else if (t.y > h * 0.75) this.sides.add('s');
    else if (t.x < w * 0.25) this.sides.add('w');
    else if (t.x > w * 0.75) this.sides.add('e');
  }

  /**
   * What each lateral move is about. An item already taken names nothing: the
   * caller drops done objectives anyway, and a keycard's stand means nothing
   * once the card is in a pocket.
   */
  private lateralMark(id: string): MarkRef | undefined {
    const level = this.level;
    if (!level) return undefined;
    const card = (kind: string): MarkRef | undefined => {
      const i = level.json.keycards.findIndex((k) => (k.kind ?? 'card') === kind);
      if (i < 0 || this.world?.keyTaken[i]) return undefined;
      return { kind: 'key', index: i };
    };
    if (id === 'lateral.power') return card('fuse');
    if (id === 'lateral.uniform') return card('uniform');
    if (id === 'lateral.card') return card('card');
    if (id === 'lateral.vault') {
      const d = level.doors.find((x) => x.kind === 'vault');
      return d ? { kind: 'door', id: d.id } : undefined;
    }
    return undefined;
  }

  /** And what the last phase's three steps are about. */
  private exfilMark(id: string): MarkRef | undefined {
    const w = this.world;
    const def = w?.exfil;
    if (!w || !def) return undefined;
    if (id === 'exfil.hole') return w.holeOpen ? undefined : { kind: 'breachWall' };
    if (id === 'exfil.van') return w.holeOpen ? { kind: 'van' } : undefined;
    if (id === 'exfil.load') {
      const p = w.player;
      // Carrying: the van. Empty-handed: whichever press is nearest, so the
      // outline never sends him across the hall for no reason.
      if (!p || w.exfilDone) return undefined;
      if (p.carrying) return { kind: 'van' };
      let best = def.presses[0];
      let bestD = Infinity;
      for (const c of def.presses) {
        const d = Math.hypot(c[0] + 0.5 - p.x, c[1] + 0.5 - p.y);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best ? { kind: 'press', cell: best } : undefined;
    }
    return undefined;
  }

  /** Getting it out, which is the only part that makes it a robbery. */
  private exfilPhase(): Phase {
    const w = this.world;
    const holeOpen = !!w?.holeOpen;
    const parked = !!w?.van.parked;
    const out = w?.loadsOut ?? 0;
    const need = w?.loadsNeeded ?? 0;
    const state = (done: boolean): ObjectiveState => (done ? 'done' : 'open');
    return {
      id: 'exfil',
      labelKey: 'missions.exfil',
      cyberKey: 'cyber.exfil',
      done: !!w?.exfilDone,
      active: false,
      objectives: [
        { ...EXFIL[0], state: state(holeOpen), discoverable: false, mark: this.exfilMark(EXFIL[0].id) },
        { ...EXFIL[1], state: state(parked), discoverable: false, mark: this.exfilMark(EXFIL[1].id) },
        {
          ...EXFIL[2],
          state: state(!!w?.exfilDone),
          discoverable: false,
          note: need ? `${out}/${need}` : undefined,
          mark: this.exfilMark(EXFIL[2].id),
        },
      ],
    };
  }

  private build(): Phase[] {
    const reconCircled = this.sides.size >= SIDES_FOR_RECON;
    const found = FOOTHOLDS.filter((f) => this.discovered.has(f.id)).length;
    const reconMapped = found >= WAYS_FOR_RECON;

    const recon: Phase = {
      id: 'recon',
      labelKey: 'missions.recon',
      cyberKey: 'cyber.recon',
      // Getting inside is proof enough that the looking-around is over.
      done: (reconCircled && reconMapped) || this.insideSeen,
      active: false,
      objectives: [
        {
          id: 'recon.circle',
          labelKey: 'missions.circle',
          cyberKey: 'cyber.externalRecon',
          state: reconCircled ? 'done' : 'open',
          discoverable: false,
        },
        {
          id: 'recon.ways',
          labelKey: 'missions.findWays',
          cyberKey: 'cyber.attackSurface',
          state: reconMapped ? 'done' : 'open',
          discoverable: false,
        },
      ],
    };

    const foothold: Phase = {
      id: 'foothold',
      labelKey: 'missions.foothold',
      cyberKey: 'cyber.initialAccess',
      done: this.insideSeen,
      active: false,
      objectives: FOOTHOLDS.map((f) => {
        const state: ObjectiveState = this.done.has(f.id)
          ? 'done'
          : this.discovered.has(f.id)
            ? 'open'
            : 'hidden';
        return {
          id: f.id,
          labelKey: f.labelKey,
          cyberKey: f.cyberKey,
          discoverable: true,
          state,
          // A way in that has not been found yet must not be lit, or the walk
          // round the building — which is the whole of the recon phase — is
          // over before it starts.
          mark: state === 'open' ? f.mark : undefined,
        };
      }),
    };

    const lateral: Phase = {
      id: 'lateral',
      labelKey: 'missions.lateral',
      cyberKey: 'cyber.lateral',
      done: this.done.has('lateral.vault'),
      active: false,
      objectives: LATERAL.map((o) => ({
        id: o.id,
        labelKey: o.labelKey,
        cyberKey: o.cyberKey,
        discoverable: false,
        // Nothing inside is a secret; the point is that they are all available.
        state: this.done.has(o.id) ? 'done' : 'open',
        mark: this.done.has(o.id) ? undefined : this.lateralMark(o.id),
      })),
    };

    // All four sections are on the board from the start: the shape of an
    // intrusion is the argument the exhibit is making, and half of it hidden
    // makes no argument at all. What is hidden is the ways in, which have to be
    // found by walking.
    const exfil = this.exfilPhase();
    const phases = [recon, foothold, lateral, exfil];
    const current = phases.find((p) => !p.done) ?? phases[phases.length - 1];
    current.active = true;
    // Standing in the vault jumps the board to the last section, whether or not
    // the optional lateral moves were ever made. That is the moment the phase
    // begins: from here the only thing that matters is the money leaving.
    if (this.vaultSeen && !exfil.done) {
      for (const p of phases) p.active = false;
      exfil.active = true;
    }
    return phases;
  }
}
