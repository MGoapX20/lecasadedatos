import type { GameFlow } from '../game/flow';
import { lang, t } from '../ui/i18n';
import { PROTOCOL, DISCOVERY, channelName, type Snapshot } from './protocol';
import { SnapshotProjector } from './snapshot';
import { TARGETS } from './targets';

/** Optional observer. No receiver message can mutate the game. */
export function mountCompanion(
  flow: GameFlow,
  toast: (message: string) => void,
) {
  const instance = crypto.randomUUID();
  let source: string = crypto.randomUUID();
  try {
    source = sessionStorage.getItem('casa.companion.source') || source;
    sessionStorage.setItem('casa.companion.source', source);
  } catch {
    /* Private browser storage can be disabled. */
  }
  let targetCursor = Math.floor(Math.random() * TARGETS.length);
  try {
    targetCursor = Number(
      localStorage.getItem('casa.companion.nextTarget') ?? targetCursor,
    );
  } catch {
    /* optional */
  }
  if (!Number.isFinite(targetCursor)) targetCursor = 0;
  const project = new SnapshotProjector(source, () => {
    const next = targetCursor++ % TARGETS.length;
    try {
      localStorage.setItem('casa.companion.nextTarget', String(targetCursor));
    } catch {
      /* optional */
    }
    return next;
  });
  let bus: BroadcastChannel | null = null;
  let discovery: BroadcastChannel | null = null;
  let latest: Snapshot | null = null;
  let nextSend = 0;
  let displayWindow: Window | null = null;
  let disposed = false;
  const url = new URL('red-team.html', location.href);
  url.search = '';
  url.searchParams.set('game', source);
  const connectBus = (): BroadcastChannel => {
    bus?.close();
    bus = new BroadcastChannel(channelName(source));
    bus.onmessage = (e) => {
      if (e.data?.type === 'hello' && e.data.v === PROTOCOL && latest)
        bus?.postMessage({ type: 'snapshot', snapshot: latest });
      if (e.data?.type === 'claim' && e.data.instance !== instance)
        bus?.postMessage({ type: 'occupied', to: e.data.instance });
      if (e.data?.type === 'occupied' && e.data.to === instance) {
        // Duplicating a browser tab also copies sessionStorage. The existing
        // game retains its ID; the duplicate gets its own isolated channel.
        source = crypto.randomUUID();
        project.source = source;
        latest = null;
        nextSend = 0;
        url.searchParams.set('game', source);
        try {
          sessionStorage.setItem('casa.companion.source', source);
        } catch {
          /* optional */
        }
        connectBus();
      }
    };
    bus.postMessage({ type: 'claim', instance });
    return bus;
  };
  try {
    bus = connectBus();
    discovery = new BroadcastChannel(DISCOVERY);
    discovery.onmessage = (e) => {
      if (e.data?.type === 'discover' && latest)
        discovery?.postMessage({
          type: 'source',
          source,
          operator: latest.operator,
          state: latest.state,
          sentAt: Date.now(),
        });
    };
  } catch {
    bus?.close();
    discovery?.close();
    bus = null;
    discovery = null;
  }
  const unsubscribe = flow.signals.on('sim', (e) => {
    try {
      project.note(flow, e);
    } catch {
      /* An optional display must not interrupt the simulation. */
    }
  });
  const open = () => {
    if (!bus) {
      toast(t('companion.unsupported'));
      return;
    }
    update(performance.now(), true);
    if (displayWindow && !displayWindow.closed) displayWindow.focus();
    else
      displayWindow = window.open(
        url.href,
        `casa-redteam-${source}`,
        'popup,width=1440,height=900',
      );
    if (!displayWindow) toast(t('companion.blocked'));
  };
  const update = (now: number, force = false) => {
    if (disposed || !bus) return;
    // Phase changes bypass the throttle so the display clears/restarts at once.
    if (!force && latest?.state === flow.state && now < nextSend) return;
    nextSend = now + (flow.state === 'round1' ? 200 : 1000);
    try {
      latest = project.capture(flow, Date.now(), lang());
      latest.suspended = document.hidden;
      bus.postMessage({ type: 'snapshot', snapshot: latest });
    } catch (error) {
      console.warn('[casa] companion disconnected', error);
      bus.close();
      bus = null;
      discovery?.close();
      discovery = null;
    }
  };
  // A heartbeat still reports pause/visibility while the render loop is hidden.
  const heartbeat = window.setInterval(() => update(performance.now()), 1000);
  const button = document.getElementById('open-red-team');
  button?.addEventListener('click', open);
  const key = (e: KeyboardEvent) => {
    if (e.code === 'F2' && !e.repeat) {
      e.preventDefault();
      open();
    }
  };
  window.addEventListener('keydown', key);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    unsubscribe();
    bus?.postMessage({ type: 'offline', source });
    bus?.close();
    discovery?.close();
    bus = null;
    discovery = null;
    window.removeEventListener('keydown', key);
    button?.removeEventListener('click', open);
  };
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) dispose();
  });
  return {
    get source() {
      return source;
    },
    get url() {
      return url.href;
    },
    open,
    update,
    dispose,
  };
}
