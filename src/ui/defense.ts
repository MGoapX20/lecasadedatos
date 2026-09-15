/** Shared symbols keep the cursor, map badges and command bar speaking one language. */
export const DEFENSE_ICONS = {
  guard: '<path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6Z"/><circle cx="12" cy="9" r="2.3"/><path d="M7.5 16c0-4 9-4 9 0"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/>',
  alarm: '<path d="M6 17v-6a6 6 0 0 1 12 0v6M4 17h16v4H4ZM12 1v2M2 5l2 2M22 5l-2 2"/>',
  blocked: '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
} as const;
export type DefenseAction = keyof typeof DEFENSE_ICONS;
export function defenseIcon(kind: DefenseAction): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${DEFENSE_ICONS[kind]}</svg>`;
}

export interface DefenseMarker {
  id: string;
  door?: number;
  kind: 'guard' | 'lock' | 'unlock';
  x: number;
  y: number;
  visible: boolean;
  label: string;
  hot: boolean;
  unavailable?: boolean;
  ordered?: boolean;
}

/** Screen-space badges anchored to the world; only door badges are buttons. */
export class DefenseOverlay {
  private layer = document.getElementById('h2-markers')!;
  private cursor = document.getElementById('cursor')!;
  private nodes = new Map<string, HTMLElement>();
  private active = false;
  onDoor: (index: number) => void = () => {};

  constructor() {
    document.querySelectorAll<HTMLElement>('[data-defense-icon]').forEach((node) => {
      node.innerHTML = defenseIcon(node.dataset.defenseIcon as DefenseAction);
    });
    this.cursor.insertAdjacentHTML('beforeend', '<span class="command-cursor-icon"></span><span class="command-cursor-label"></span>');
  }

  show(active: boolean): void {
    this.active = active;
    document.documentElement.classList.toggle('defending', active);
    this.cursor.classList.toggle('command-cursor', active);
    if (!active) this.layer.replaceChildren();
    if (!active) this.nodes.clear();
  }

  setCursor(kind: DefenseAction, label: string): void {
    if (!this.active) return;
    if (this.cursor.dataset.action !== kind) {
      this.cursor.dataset.action = kind;
      this.cursor.querySelector('.command-cursor-icon')!.innerHTML = defenseIcon(kind);
    }
    this.cursor.querySelector('.command-cursor-label')!.textContent = label;
    const x = parseFloat(this.cursor.style.left) || 0;
    const y = parseFloat(this.cursor.style.top) || 0;
    this.cursor.classList.toggle('label-left', x > window.innerWidth - 210);
    this.cursor.classList.toggle('label-above', y > window.innerHeight - 65);
  }

  /** Virtual and mouse cursors both recognize the visible badge, not the floor behind it. */
  hit(x: number, y: number): { door?: number; ui: boolean; alarm: boolean } {
    const node = document.elementFromPoint(x, y);
    const badge = node?.closest<HTMLElement>('[data-defense-door]');
    return {
      door: badge ? Number(badge.dataset.defenseDoor) : undefined,
      ui: !!node?.closest('.defense-dock, .defense-top, .ways, .menu, #admin-panel') || this.covered(x, y),
      alarm: !!node?.closest('#h2-alarm-chip'),
    };
  }

  private covers(): DOMRect[] {
    return [...document.querySelectorAll<HTMLElement>('#hud-minimap, .ways.on, .defense-controls, .defense-top')].map((node) => node.getBoundingClientRect());
  }

  private covered(x: number, y: number, covers = this.covers()): boolean {
    return covers.some((rect) => rect.width > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  setMarkers(markers: DefenseMarker[]): void {
    if (!this.active) return;
    const covers = this.covers();
    for (const marker of markers) {
      let node = this.nodes.get(marker.id);
      if (!node) {
        node = document.createElement(marker.door === undefined ? 'div' : 'button');
        node.className = 'defense-marker';
        node.innerHTML = '<span class="defense-marker-icon"></span><span class="defense-marker-label"></span>';
        node.dataset.testid = `defense-${marker.id}`;
        if (marker.door !== undefined) {
          const index = marker.door;
          node.dataset.defenseDoor = String(index);
          (node as HTMLButtonElement).type = 'button';
          node.addEventListener('click', () => this.onDoor(index));
        }
        this.nodes.set(marker.id, node);
        this.layer.appendChild(node);
      }
      node.hidden = !marker.visible || this.covered(marker.x, marker.y - 18, covers);
      if (node.hidden) continue;
      node.style.left = `${marker.x}px`;
      node.style.top = `${marker.y}px`;
      if (node.dataset.kind !== marker.kind) {
        node.dataset.kind = marker.kind;
        node.firstElementChild!.innerHTML = defenseIcon(marker.kind);
      }
      node.classList.toggle('hot', marker.hot);
      node.classList.toggle('ordered', !!marker.ordered);
      node.classList.toggle('unavailable', !!marker.unavailable);
      node.setAttribute('aria-label', marker.label);
      if (marker.door !== undefined) node.setAttribute('aria-disabled', String(!!marker.unavailable));
      node.lastElementChild!.textContent = marker.label;
    }
  }
}
