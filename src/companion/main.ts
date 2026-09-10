import {
  PROTOCOL,
  DISCOVERY,
  SnapshotInbox,
  channelName,
  type SourceInfo,
} from './protocol';
import { esc, frameKey, renderSnapshot, sceneId } from './scenes';
import { reconcile } from './dom';
import { fitBoard } from './fit';

const root = document.getElementById('companion')!;
const display = document.getElementById('display')!;
const stopFitting = fitBoard(document.getElementById('viewport')!, display);
const connection = document.getElementById('connection')!;
const notice = document.getElementById('connection-notice')!;
const fullscreen = document.getElementById('fullscreen')!;
let inbox: SnapshotInbox | null = null;
let bus: BroadcastChannel | null = null;
let discovery: BroadcastChannel | null = null;
let offline = false;
let drawnFrame = '';
let transportError = false;
const sources = new Map<string, SourceInfo>();
const pairedSource = new URL(location.href).searchParams.get('game');

function connect(source: string): void {
  bus?.close();
  inbox = new SnapshotInbox(source);
  drawnFrame = '';
  offline = false;
  bus = new BroadcastChannel(channelName(source));
  const url = new URL(location.href);
  url.searchParams.set('game', source);
  history.replaceState(null, '', url);
  bus.onmessage = (e) => {
    if (e.data?.type === 'offline' && e.data.source === source) {
      offline = true;
      render();
    }
    if (
      e.data?.type === 'snapshot' &&
      inbox?.accept(e.data.snapshot, performance.now())
    ) {
      offline = false;
      render();
    }
  };
  bus.postMessage({ type: 'hello', v: PROTOCOL });
}

function render(): void {
  if (transportError) {
    connection.textContent = 'CONNECTION UNAVAILABLE';
    return;
  }
  const s = inbox?.latest;
  const stale = !inbox || inbox.stale(performance.now()) || offline;
  const active = s?.state === 'round1';
  if (s && frameKey(s) !== drawnFrame) {
    reconcile(display, renderSnapshot(s));
    drawnFrame = frameKey(s);
    document.documentElement.lang = s.language;
    document.getElementById('footer-phase')!.textContent = active
      ? `${s.operator.toUpperCase()} / ${sceneId(s).replaceAll('-', ' ').toUpperCase()}`
      : s.language === 'he'
        ? 'סבב הגנב / ממתינים'
        : 'THIEF ROUND / STANDBY';
    document.getElementById('simulation-label')!.textContent =
      s.language === 'he'
        ? 'יעד בדיוני · אירועי משחק בזמן אמת'
        : 'FICTIONAL TARGET · LIVE GAME EVENTS';
    fullscreen.querySelector('span')!.textContent =
      s.language === 'he' ? 'מסך מלא' : 'Fullscreen';
  }
  root.dataset.stopped = String(
    !active || stale || !!s?.paused || !!s?.suspended,
  );
  connection.className = `connection ${stale ? 'lost' : !active ? 'ready' : s?.paused || s?.suspended ? 'paused' : 'live'}`;
  connection.textContent =
    s?.language === 'he'
      ? stale
        ? 'ממתינים למשחק'
        : !active
          ? 'מוכן / סבב הגנב בלבד'
          : s.paused
            ? 'המשחק מושהה'
            : s.suspended
              ? 'המשחק מוסתר'
              : 'מסונכרן'
      : stale
        ? 'WAITING FOR GAME'
        : !active
          ? 'READY / THIEF ROUND ONLY'
          : s?.paused
            ? 'GAME PAUSED'
            : s?.suspended
              ? 'GAME HIDDEN'
              : 'LIVE / SYNCED';
  notice.hidden = !s || (!stale && (!active || (!s.paused && !s.suspended)));
  if (s)
    notice.textContent =
      s.language === 'he'
        ? stale
          ? 'החיבור למשחק אבד. פתחו את מסך המשחק באותו דפדפן כדי להתחבר מחדש.'
          : s.paused
            ? 'המשחק מושהה. המסך ממתין להמשך המשחק.'
            : 'מסך המשחק מוסתר. הציגו את שני החלונות זה לצד זה או בשני מסכים.'
        : stale
          ? 'The game connection is quiet. Return to the main game in this browser to reconnect.'
          : s.paused
            ? 'The game is paused. This display will continue when the game resumes.'
            : 'The game is hidden. Keep both windows visible, side by side or on separate monitors.';
}

function showSources(): void {
  if (inbox) return;
  const current = Array.from(sources.values()).filter(
    (s) => Date.now() - s.sentAt < 5000,
  );
  const container = document.getElementById('sources');
  if (!container) return;
  if (current.length === 1) {
    connect(current[0].source);
    return;
  }
  container.innerHTML = current.length
    ? `<p>Choose the game to follow:</p>${current.map((s) => `<button type="button" class="source-choice" data-source="${esc(s.source)}">${esc(s.operator)}<small>${esc(s.state)} · ${esc(s.source.slice(0, 8))}</small></button>`).join('')}`
    : '';
}
display.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement).closest<HTMLButtonElement>(
    '[data-source]',
  );
  if (button?.dataset.source) connect(button.dataset.source);
});

try {
  if (pairedSource) connect(pairedSource);
  else {
    discovery = new BroadcastChannel(DISCOVERY);
    discovery.onmessage = (e) => {
      if (
        e.data?.type === 'source' &&
        typeof e.data.source === 'string' &&
        typeof e.data.operator === 'string'
      )
        sources.set(e.data.source, e.data);
    };
    discovery.postMessage({ type: 'discover' });
    // Gather a full response window before choosing; two games must not race.
    window.setTimeout(showSources, 700);
  }
} catch {
  transportError = true;
  notice.hidden = false;
  notice.textContent =
    'This browser cannot connect the display. Open both pages in a current desktop browser using the same profile and address.';
}
const timer = window.setInterval(() => {
  if (!inbox) {
    discovery?.postMessage({ type: 'discover' });
    showSources();
  } else if (inbox.stale(performance.now()))
    bus?.postMessage({ type: 'hello', v: PROTOCOL });
  render();
}, 1000);
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notice.hidden = false;
    notice.textContent =
      'Use the browser’s fullscreen control to fill this monitor.';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    fullscreen.click();
  }
});
window.addEventListener('pagehide', (e) => {
  if (e.persisted) return;
  stopFitting();
  clearInterval(timer);
  bus?.close();
  discovery?.close();
});
