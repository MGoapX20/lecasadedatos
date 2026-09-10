import type { GameFlow } from './flow';

/** Operator controls and a stable, validated interface for browser tests. */
export type AdminHost = Pick<GameFlow, 'adminStatus' | 'adminAction' | 'setAdminOption' | 'paused'>;
export function mountAdmin(flow: AdminHost, closeMenu: () => void, standalone = false) {
  const root = document.createElement('aside');
  root.id = 'admin-panel';
  root.setAttribute('aria-label', 'Admin panel');
  root.dir = 'ltr';
  root.hidden = true;
  root.innerHTML = `
    <header><h2>Admin / testing</h2><button type="button" data-testid="admin-close">Close</button></header>
    <output data-testid="admin-status" aria-live="polite"></output>
    <div class="admin-actions">
      <button data-testid="admin-start-round1" data-action="startRound1">Start round 1</button>
      <button data-testid="admin-skip" data-action="skip">Skip stage</button>
      <button data-testid="admin-reset-stage" data-action="resetStage">Reset stage</button>
      <button data-testid="admin-restart" data-action="restart">Restart visit</button>
    </div>
    <label><input type="checkbox" data-testid="admin-paused"> Pause simulation</label>
    <label><input type="checkbox" data-option="catches" data-testid="admin-catches"> Catches enabled</label>
    <label><input type="checkbox" data-option="timers" data-testid="admin-timers"> Stage timers enabled</label>
    <label><input type="checkbox" data-option="uniform" data-testid="admin-uniform"> Player wearing uniform</label>
    <label><input type="checkbox" data-option="power" data-testid="admin-power"> Camera power enabled</label>
    <label><input type="checkbox" data-option="missions" data-testid="admin-missions"> Show mission board</label>
    <p>${standalone ? 'Changes apply to the selected game until that game reloads.' : 'F3 opens/closes · Changes last until reload.'} Timers off also disables idle resets; guards and mini-games keep running. Uniform requires a player. An alarm still defeats the disguise.</p>
    <p>Admin-assisted visits are excluded from the leaderboard.</p>
    <nav aria-label="Game URLs" data-testid="admin-urls"><h3>Game URLs</h3><ul></ul></nav>
    <output data-testid="admin-error" role="alert"></output>`;
  document.body.append(root);
  const urls = [
    { label: 'Game', path: './' },
    { label: 'Game (HTML entry)', path: 'index.html' },
    { label: 'Standalone admin page', path: 'admin.html' },
    { label: 'Red-team companion (session picker)', path: 'red-team.html' },
    ...(import.meta.env.DEV ? [{ label: 'Highlight rendering check (development only)', path: 'tools/highlight-check.html' }] : []),
    ...(import.meta.env.DEV ? [{ label: 'Camera power regression (development only)', path: 'tools/power-check.html' }] : []),
  ];
  for (const { label, path } of urls) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = new URL(path, location.href).href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = label;
    const address = document.createElement('small');
    address.textContent = link.href;
    item.append(link, address);
    root.querySelector('[data-testid="admin-urls"] ul')!.append(item);
  }
  const style = document.createElement('style');
  style.textContent = `#admin-panel{position:fixed;right:16px;top:16px;z-index:10000;width:min(360px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:18px;background:#111a24;color:#f5f8ff;border:1px solid #7892aa;border-radius:10px;font:15px/1.4 system-ui;box-shadow:0 12px 40px #0009;pointer-events:auto}#admin-panel[hidden]{display:none}#admin-panel header{display:flex;justify-content:space-between;align-items:center}#admin-panel h2{font:700 20px system-ui;margin:0 0 10px}#admin-panel button{font:inherit;color:#fff;background:#294159;border:1px solid #68849f;border-radius:5px;padding:7px;cursor:pointer}#admin-panel button:focus-visible,#admin-panel input:focus-visible{outline:3px solid #79e0ad}#admin-panel .admin-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}#admin-panel label{display:flex;gap:10px;align-items:center;padding:7px 0}#admin-panel input{width:18px;height:18px;accent-color:#69dca0}#admin-panel p{font-size:12px;color:#b7c9da}#admin-panel output{display:block}#admin-panel [role=alert]{color:#ffb6a8}`;
  document.head.append(style);
  style.textContent += '#admin-panel nav h3{font-size:15px;margin:14px 0 6px}#admin-panel nav ul{list-style:none;margin:0;padding:0}#admin-panel nav li{margin:10px 0}#admin-panel nav a{color:#88dcff;text-decoration:underline}#admin-panel nav small{display:block;overflow-wrap:anywhere;color:#b7c9da;font-size:11px}';
  const status = root.querySelector<HTMLOutputElement>('[data-testid="admin-status"]')!;
  const error = root.querySelector<HTMLOutputElement>('[data-testid="admin-error"]')!;
  let lastStatus = '';
  const refresh = () => {
    const s = flow.adminStatus;
    const text = `${s.stage} · ${(s.elapsedMs / 1000).toFixed(1)}s${s.assisted ? ' · TEST VISIT' : ''}${s.waitingForSwarm ? ' · preparing routes…' : ''}`;
    if (text !== lastStatus) { status.textContent = text; lastStatus = text; }
    for (const option of ['catches', 'timers', 'uniform', 'power', 'missions'] as const) {
      const input = root.querySelector<HTMLInputElement>(`[data-option="${option}"]`)!;
      input.checked = s[option];
      input.disabled = option === 'uniform' && !s.hasPlayer;
    }
    root.querySelector<HTMLInputElement>('[data-testid="admin-paused"]')!.checked = s.paused;
  };
  const api = {
    getState: () => flow.adminStatus,
    show: () => { closeMenu(); root.hidden = false; refresh(); },
    hide: () => {
      if (standalone) return;
      if (root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      root.hidden = true;
    },
    action: (action: string) => {
      if (!['skip', 'resetStage', 'restart', 'startRound1'].includes(action)) throw new Error(`Unknown admin action: ${action}`);
      flow.adminAction(action as Parameters<GameFlow['adminAction']>[0]); refresh();
      return flow.adminStatus;
    },
    set: (option: string, enabled: boolean) => {
      if (typeof enabled !== 'boolean') throw new Error('Admin options require a boolean');
      if (option === 'paused') flow.paused = enabled;
      else if (['catches', 'timers', 'uniform', 'power', 'missions'].includes(option)) flow.setAdminOption(option as Parameters<GameFlow['setAdminOption']>[0], enabled);
      else throw new Error(`Unknown admin option: ${option}`);
      refresh(); return flow.adminStatus;
    },
    update: () => { if (!root.hidden) refresh(); },
  };
  const perform = (fn: () => unknown) => { try { error.textContent = ''; fn(); } catch (e) { error.textContent = String(e); } };
  root.querySelector('[data-testid="admin-close"]')!.addEventListener('click', api.hide);
  root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => perform(() => api.action(button.dataset.action!))));
  root.querySelectorAll<HTMLInputElement>('[data-option]').forEach(input => input.addEventListener('change', () => perform(() => api.set(input.dataset.option!, input.checked))));
  root.querySelector<HTMLInputElement>('[data-testid="admin-paused"]')!.addEventListener('change', e => perform(() => api.set('paused', (e.target as HTMLInputElement).checked)));
  // Panel interactions must never click-to-walk, cut wires, or rotate the game.
  for (const name of ['keydown', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) root.addEventListener(name, e => {
    if (e instanceof KeyboardEvent && e.code === 'F3') { e.preventDefault(); api.hide(); }
    e.stopPropagation();
  });
  window.addEventListener('keydown', e => {
    if (standalone) return;
    if (e.code !== 'F3') return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) { if (root.hidden) api.show(); else api.hide(); }
  }, true);
  return api;
}
