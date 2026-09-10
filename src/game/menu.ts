import { config, saveConfig, type Quality } from '../config';
import type { AudioBus } from '../audio/audio';
import type { InputState } from '../input/input';
import type { Stage } from '../render/renderer';
import { clearBoard } from './leaderboard';
import { setLang, t, lang } from '../ui/i18n';
import type { Overlay } from '../ui/overlay';

type RowKind = 'action' | 'choice' | 'range' | 'toggle' | 'separator';

interface Row {
  id: string;
  kind: RowKind;
  labelKey: string;
  /** Current display value. */
  value?: () => string;
  /** Left/right or click cycles the value. */
  adjust?: (delta: number) => void;
  activate?: () => void;
}

export interface MenuDeps {
  overlay: Overlay;
  audio: AudioBus;
  stage: Stage;
  onResume: () => void;
  onRestart: () => void;
  onSkip: () => void;
  onPresenter: () => void;
  onCompanion: () => void;
}

const QUALITIES: Quality[] = ['high', 'medium', 'low'];

/**
 * The pause menu. It is the only place a visitor or the person running the
 * stand can change anything mid-visit, so it also carries the settings the
 * stand actually needs: language, graphics load, swarm size and volume.
 */
export class PauseMenu {
  private root = document.getElementById('scr-menu') as HTMLElement;
  private list = document.getElementById('menu-rows') as HTMLElement;
  private rows: Row[] = [];
  private focus = 0;
  private repeatCooldown = 0;
  open = false;

  constructor(private readonly d: MenuDeps) {
    this.rows = [
      { id: 'resume', kind: 'action', labelKey: 'menu.resume', activate: () => this.close() },
      { id: 'companion', kind: 'action', labelKey: 'menu.companion', activate: () => { this.close(); d.onCompanion(); } },
      { id: 'skip', kind: 'action', labelKey: 'menu.skip', activate: () => { this.close(); d.onSkip(); } },
      { id: 'restart', kind: 'action', labelKey: 'menu.restart', activate: () => { this.close(); d.onRestart(); } },
      { id: 'sep1', kind: 'separator', labelKey: '' },
      {
        id: 'language',
        kind: 'choice',
        labelKey: 'menu.language',
        value: () => (lang() === 'en' ? 'English' : 'עברית'),
        adjust: () => setLang(lang() === 'en' ? 'he' : 'en'),
        activate: () => setLang(lang() === 'en' ? 'he' : 'en'),
      },
      {
        id: 'quality',
        kind: 'choice',
        labelKey: 'menu.quality',
        value: () => t(`quality.${config.quality}`),
        adjust: (delta) => {
          const i = QUALITIES.indexOf(config.quality);
          config.quality = QUALITIES[(i + delta + QUALITIES.length) % QUALITIES.length];
          saveConfig();
          d.stage.setQuality(config.quality);
        },
        activate: () => this.rowById('quality')?.adjust?.(1),
      },
      {
        id: 'swarm',
        kind: 'range',
        labelKey: 'menu.swarm',
        value: () => String(config.swarmSize),
        adjust: (delta) => {
          config.swarmSize = Math.min(120, Math.max(20, config.swarmSize + delta * 10));
          saveConfig();
        },
      },
      {
        id: 'music',
        kind: 'range',
        labelKey: 'menu.music',
        value: () => `${Math.round(config.musicVolume * 100)}%`,
        adjust: (delta) => {
          config.musicVolume = clamp01(config.musicVolume + delta * 0.1);
          saveConfig();
          d.audio.fadeMusic(config.musicVolume, 0.2);
        },
      },
      {
        id: 'sfx',
        kind: 'range',
        labelKey: 'menu.sfx',
        value: () => `${Math.round(config.sfxVolume * 100)}%`,
        adjust: (delta) => {
          config.sfxVolume = clamp01(config.sfxVolume + delta * 0.1);
          saveConfig();
          d.audio.play('blip');
        },
      },
      {
        id: 'fullscreen',
        kind: 'toggle',
        labelKey: 'menu.fullscreen',
        value: () => (document.fullscreenElement ? t('menu.on') : t('menu.off')),
        activate: () => void this.toggleFullscreen(),
        adjust: () => void this.toggleFullscreen(),
      },
      { id: 'sep2', kind: 'separator', labelKey: '' },
      {
        id: 'presenter',
        kind: 'action',
        labelKey: 'menu.presenter',
        activate: () => {
          this.close();
          d.onPresenter();
        },
      },
      {
        id: 'clear',
        kind: 'action',
        labelKey: 'menu.clearBoard',
        activate: () => {
          clearBoard();
          d.overlay.setWanted([]);
          d.overlay.toast(t('menu.clearBoard'));
        },
      },
    ];
    this.build();
  }

  private rowById(id: string): Row | undefined {
    return this.rows.find((r) => r.id === id);
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      this.d.overlay.toast('fullscreen blocked');
    }
    this.render();
  }

  private build(): void {
    this.list.textContent = '';
    this.rows.forEach((row, i) => {
      const li = document.createElement('li');
      li.className = row.kind === 'separator' ? 'menu-row sep' : 'menu-row';
      li.dataset.index = String(i);
      if (row.kind === 'separator') {
        li.appendChild(document.createElement('hr'));
      } else {
        const label = document.createElement('span');
        label.className = 'menu-label';
        li.appendChild(label);
        const value = document.createElement('span');
        value.className = 'menu-value';
        li.appendChild(value);
        li.addEventListener('mouseenter', () => {
          this.focus = i;
          this.render();
        });

        const steppable = row.kind === 'range' || row.kind === 'choice';
        if (steppable) {
          // Anything with a value needs both directions. A row that only ever
          // steps up leaves no way to turn the music down with a mouse.
          const step = (delta: number) => {
            const b = document.createElement('button');
            b.className = 'menu-step';
            b.type = 'button';
            b.textContent = delta < 0 ? '\u25c0' : '\u25b6';
            b.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.focus = i;
              row.adjust?.(delta);
              this.d.audio.play('blip');
              this.render();
            });
            return b;
          };
          const num = document.createElement('span');
          num.className = 'menu-num';
          value.append(step(-1), num, step(1));
        } else {
          li.addEventListener('click', () => {
            if (row.activate) row.activate();
            else row.adjust?.(1);
            this.d.audio.play('confirm');
            this.render();
          });
        }
      }
      this.list.appendChild(li);
    });
  }

  private render(): void {
    const nodes = Array.from(this.list.children) as HTMLElement[];
    this.rows.forEach((row, i) => {
      const li = nodes[i];
      if (!li || row.kind === 'separator') return;
      li.classList.toggle('focused', i === this.focus);
      (li.children[0] as HTMLElement).textContent = t(row.labelKey);
      const value = li.children[1] as HTMLElement;
      const num = value.querySelector('.menu-num');
      if (num) num.textContent = row.value ? row.value() : '';
      else value.textContent = row.value ? row.value() : '';
    });
  }

  private move(delta: number): void {
    const n = this.rows.length;
    let i = this.focus;
    for (let k = 0; k < n; k++) {
      i = (i + delta + n) % n;
      if (this.rows[i].kind !== 'separator') break;
    }
    this.focus = i;
    this.d.audio.play('blip');
    this.render();
  }

  show(): void {
    this.open = true;
    this.focus = 0;
    this.root.classList.add('on');
    this.d.overlay.setMenuOpen(true);
    this.d.overlay.applyI18n();
    this.render();
  }

  close(): void {
    this.open = false;
    this.root.classList.remove('on');
    this.d.overlay.setMenuOpen(false);
    this.d.onResume();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  /** Keyboard and gamepad navigation, with a repeat delay so a held stick behaves. */
  update(input: InputState, dtMs: number): void {
    if (!this.open) return;
    this.repeatCooldown = Math.max(0, this.repeatCooldown - dtMs);
    const row = this.rows[this.focus];
    const vy = input.move.y;
    const vx = input.move.x;
    if (this.repeatCooldown === 0) {
      if (vy < -0.5) {
        this.move(-1);
        this.repeatCooldown = 190;
      } else if (vy > 0.5) {
        this.move(1);
        this.repeatCooldown = 190;
      } else if (vx < -0.5) {
        row?.adjust?.(this.d.overlay.rtl ? 1 : -1);
        this.d.audio.play('blip');
        this.render();
        this.repeatCooldown = 190;
      } else if (vx > 0.5) {
        row?.adjust?.(this.d.overlay.rtl ? -1 : 1);
        this.d.audio.play('blip');
        this.render();
        this.repeatCooldown = 190;
      }
    }
    if (input.confirm.pressed) {
      if (row?.activate) row.activate();
      else row?.adjust?.(1);
      this.d.audio.play('confirm');
      this.render();
    }
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 100) / 100));
}
