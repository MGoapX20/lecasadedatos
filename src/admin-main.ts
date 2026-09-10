import { mountAdmin, type AdminHost } from './game/admin';
import { adminChannelName } from './game/admin-channel';

type Snapshot = AdminHost['adminStatus'];
const sessions = new Map<string, { state: Snapshot; url: string; seen: number }>();
const selector = document.querySelector<HTMLSelectElement>('#game-session')!;
const connection = document.querySelector<HTMLElement>('#connection')!;
const commandStatus = document.querySelector<HTMLElement>('#command-status')!;
const channel = new BroadcastChannel(adminChannelName());
let selected = '';
let pending: { id: string; at: number } | null = null;
const empty: Snapshot = { stage: 'attract', elapsedMs: 0, paused: false, catches: true, timers: true, uniform: false, power: true, hasPlayer: false, assisted: false, waitingForSwarm: false };
const state = () => sessions.get(selected)?.state ?? empty;
function send(method: 'action' | 'set', name: string, value?: boolean) {
  if (!sessions.has(selected)) throw new Error('Open and select a game tab first.');
  if (pending) throw new Error('Waiting for the previous command.');
  const request = crypto.randomUUID();
  pending = { id: request, at: Date.now() };
  commandStatus.textContent = 'Applying change…';
  channel.postMessage({ type: 'command', target: selected, request, method, name, value });
}
const host: AdminHost = {
  get adminStatus() { return state(); },
  get paused() { return state().paused; },
  set paused(value) { send('set', 'paused', value); },
  adminAction: action => send('action', action),
  setAdminOption: (option, value) => send('set', option, value),
};
const panel = mountAdmin(host, () => {}, true);
panel.show();
const root = document.querySelector<HTMLElement>('#admin-panel')!;
root.querySelector<HTMLElement>('[data-testid="admin-close"]')!.hidden = true;
const style = document.createElement('style');
style.textContent = `body{margin:0;padding:32px;background:#0c131d;color:#f5f8ff;font:16px/1.5 system-ui}main{max-width:720px;margin:auto}h1{font-size:26px}a{color:#88dcff}select{padding:8px;background:#223448;color:#fff;max-width:100%}#admin-panel{position:static;width:100%;max-width:720px;max-height:none;margin:24px auto;box-shadow:none}#admin-panel[hidden]{display:block}#command-status{color:#f0d085}#admin-panel button:disabled{opacity:.5;cursor:default}`;
document.head.append(style);
function refresh() {
  for (const [id, session] of sessions) if (Date.now() - session.seen > 6000) sessions.delete(id);
  // Never silently switch targets after a disconnect when other games exist.
  if (!selected && sessions.size === 1) selected = sessions.keys().next().value!;
  const options = [...sessions].map(([id, session]) => ({ id, label: `${session.state.stage} · ${id.slice(0, 8)} · ${session.url}` }));
  const signature = JSON.stringify(options);
  if (selector.dataset.options !== signature) {
    selector.replaceChildren(new Option('Select a game…', ''), ...options.map(o => new Option(o.label, o.id)));
    selector.dataset.options = signature;
  }
  selector.value = sessions.has(selected) ? selected : '';
  connection.hidden = sessions.has(selected);
  connection.textContent = sessions.has(selected) ? '' : 'No game connected. Open a game in another tab using the same browser and address.';
  if (pending && Date.now() - pending.at > 5000) {
    pending = null;
    commandStatus.textContent = 'No acknowledgement received. Check the game state before retrying.';
  }
  panel.update();
  root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach(control => {
    control.disabled = !sessions.has(selected) || !!pending || (control.dataset.option === 'uniform' && !state().hasPlayer);
  });
}
selector.addEventListener('change', () => { selected = selector.value; pending = null; commandStatus.textContent = ''; refresh(); });
channel.onmessage = ({ data }) => {
  if (!data || typeof data.id !== 'string') return;
  if (data.type === 'state' && data.state && typeof data.state.stage === 'string' && typeof data.url === 'string') {
    sessions.set(data.id, { state: data.state, url: data.url, seen: Date.now() });
  } else if (data.type === 'gone') sessions.delete(data.id);
  else if ((data.type === 'ack' || data.type === 'error') && data.id === selected && data.request === pending?.id) {
    pending = null;
    commandStatus.textContent = data.type === 'ack' ? 'Change applied.' : String(data.message);
  }
  refresh();
};
window.setInterval(() => { channel.postMessage({ type: 'discover' }); refresh(); }, 1000);
channel.postMessage({ type: 'discover' });
refresh();
