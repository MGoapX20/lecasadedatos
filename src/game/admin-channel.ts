import type { mountAdmin } from './admin';

// Scope discovery to this deployment; another local project must not respond.
export const adminChannelName = () => `casa-admin:${new URL('.', location.href).pathname}`;

export function publishAdmin(api: ReturnType<typeof mountAdmin>) {
  const channel = new BroadcastChannel(adminChannelName());
  const id = crypto.randomUUID();
  const announce = () => channel.postMessage({ type: 'state', id, url: location.href, state: api.getState() });
  channel.onmessage = ({ data }) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'discover') { announce(); return; }
    if (data.type !== 'command' || data.target !== id || typeof data.request !== 'string') return;
    try {
      if (data.method === 'action' && typeof data.name === 'string') api.action(data.name);
      else if (data.method === 'set' && typeof data.name === 'string') api.set(data.name, data.value);
      else throw new Error('Invalid admin command');
      channel.postMessage({ type: 'ack', id, request: data.request });
    } catch (error) {
      channel.postMessage({ type: 'error', id, request: data.request, message: String(error) });
    }
    announce();
  };
  const timer = window.setInterval(announce, 500);
  announce();
  window.addEventListener('pagehide', () => {
    clearInterval(timer);
    channel.postMessage({ type: 'gone', id });
    channel.close();
  }, { once: true });
}
