import type {
  EntryId,
  JournalEvent,
  ThiefSnapshot as Snapshot,
  Snapshot as DisplaySnapshot,
} from './protocol';
import { targetAt, type Target } from './targets';

import { esc } from './html';
export { esc } from './html';
import { renderDefense } from './siem';
const tr = (s: DisplaySnapshot, en: string, he: string) =>
  s.language === 'he' ? he : en;
const percent = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100);
const clock = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, '0')}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, '0')}`;
const stat = (label: string, value: string | number, tone = '') =>
  `<div class="stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const bar = (amount: number, className = '') =>
  `<div class="meter ${className}"><i style="width:${percent(amount)}%"></i></div>`;
const panel = (title: string, tag: string, body: string, className = '') =>
  `<section class="panel ${className}"><div class="panel-head"><h3>${esc(title)}</h3><span>${esc(tag)}</span></div>${body}</section>`;
const tag = (text: string, tone = '') =>
  `<span class="tag ${tone}">${esc(text)}</span>`;
const phaseLabels = [
  ['recon', 'Reconnaissance', 'איסוף מידע'],
  ['foothold', 'Initial access', 'גישה ראשונית'],
  ['lateral', 'Lateral movement', 'תנועה רוחבית'],
  ['exfil', 'Data exfiltration', 'הוצאת מידע'],
] as const;
const entryLabels: Record<EntryId, string> = {
  front: 'Phishing',
  side: 'Known vulnerability',
  dock: 'Supply chain',
  vent: 'Unpatched gateway',
  sewer: 'Unknown API flaw',
};
const done = (s: Snapshot, id: string) =>
  s.objectives.some((o) => o.id === id && o.state === 'done');
const recent = (s: Snapshot, kinds: string[], ticks = 140) =>
  [...s.events]
    .reverse()
    .find(
      (e) =>
        e.stage === s.state &&
        kinds.includes(e.event.kind) &&
        s.tick - e.tick >= 0 &&
        s.tick - e.tick < ticks,
    );

export function sceneId(s: DisplaySnapshot): string {
  if ('defense' in s) return `defense-${s.state === 'round2a' ? 'single' : s.state === 'round2b' ? 'swarm' : s.state === 'aiThink' ? 'planning' : 'ready'}`;
  if (s.state === 'round1') {
    if (s.phase === 'exfil') return 'exfil';
    if (s.interaction?.kind === 'wire') return 'lateral-power';
    if (s.interaction?.kind === 'lockpick' && !s.player?.inside)
      return 'access-side';
    if (s.interaction?.kind === 'truck') return 'access-dock';
    if (s.player?.hidden && ['vent', 'sewer'].includes(s.focusEntry))
      return `access-${s.focusEntry}`;
    if (s.phase === 'recon') return 'recon';
    if (s.phase === 'foothold') return `access-${s.focusEntry}`;
    const event = recent(s, ['powerCut', 'disguised', 'pickup'], 180);
    if (event?.event.kind === 'powerCut') return 'lateral-power';
    if (event?.event.kind === 'disguised') return 'lateral-uniform';
    if (event?.event.kind === 'pickup' && s.player?.card) return 'lateral-card';
    return 'lateral';
  }
  return 'standby';
}

function browser(t: Target, body: string): string {
  return `<section class="fictional-browser"><div class="browser-chrome"><span class="window-dots"><i></i><i></i><i></i></span><span class="address">◈ &nbsp; ${t.domain}</span></div><div class="public-site site-${t.style}" style="--site-color:${t.color}">${body}</div></section>`;
}

/** Six authored compositions, rather than a single mock site recolored six times. */
function website(t: Target): string {
  const heading = esc(t.headline).replace(/\n/g, '<br>');
  if (t.style === 'orbital')
    return browser(
      t,
      `<div class="site-nav"><b>✳ ${t.short}</b><span>MISSIONS &nbsp; / &nbsp; COMPANY</span></div><div class="orbital-hero"><span class="site-kicker">EARTH / LEO / BEYOND</span><h2>${heading}</h2><p>${t.subline}</p></div><div class="flight-board"><div>FLIGHT <b>DESTINATION</b><span>STATUS</span></div><div>AO–218 <b>KEPLER STATION</b><span>MANIFEST OPEN</span></div><div>AO–221 <b>DAWN PLATFORM</b><span>IN TRANSIT</span></div><div>AO–224 <b>LOW EARTH ORBIT</b><span>BOOKING</span></div></div><div class="site-bottom">NEXT LAUNCH WINDOW <strong>09 / 24</strong></div>`,
    );
  if (t.style === 'lab')
    return browser(
      t,
      `<div class="site-nav"><b>v / ${t.short}</b><span>SCIENCE &nbsp; PEOPLE &nbsp; CONTACT</span></div><div class="lab-hero"><span class="site-kicker">RESEARCH THAT LIVES.</span><h2>${heading}</h2><p>${t.subline}</p><div class="lab-index"><b>01</b><span>Living materials</span><b>02</b><span>Cellular systems</span><b>03</b><span>Future therapies</span></div></div><div class="lab-publication"><span>FROM THE LAB / PUBLICATION 026</span><strong>Designing with living systems.</strong><small>Research notes &nbsp; ↗</small></div>`,
    );
  if (t.style === 'culture')
    return browser(
      t,
      `<div class="site-nav"><b>${t.short}</b><span>PROGRAM / TICKETS</span></div><div class="culture-hero"><span>SEASON 026 / OPEN UNTIL LATE</span><h2>${heading}</h2><p>${t.subline}</p></div><div class="event-grid"><article><b>FRI<br>18</b><span>SOUND WITHOUT BORDERS</span><small>LIVE / STUDIO 01</small></article><article><b>SAT<br>19</b><span>THE SPACE BETWEEN</span><small>EXHIBITION / ALL NIGHT</small></article></div>`,
    );
  if (t.style === 'energy')
    return browser(
      t,
      `<div class="site-nav"><b>≋ ${t.short}</b><span>OUR NETWORK &nbsp; JOIN US</span></div><div class="energy-hero"><span class="site-kicker">POWER BELONGS TO EVERYONE.</span><h2>${heading}</h2><p>${t.subline}</p><div class="energy-readout"><strong>64.8<small> MW</small></strong><span>COMMUNITY GENERATION</span></div><div class="energy-bars">${[23, 42, 34, 55, 45, 65, 72, 59, 84, 68, 95, 84, 73, 93, 80, 100, 78, 90].map((h) => `<i style="height:${h}%"></i>`).join('')}</div></div><div class="site-bottom">NETWORK STATUS <strong>CONNECTED</strong></div>`,
    );
  if (t.style === 'finance')
    return browser(
      t,
      `<div class="site-nav"><b>◒ ${t.short}</b><span>PERSONAL &nbsp; BUSINESS</span></div><div class="finance-hero"><span class="site-kicker">MEMBER OWNED. MEMBER FIRST.</span><h2>${heading}</h2><p>${t.subline}</p><span class="fake-button">Explore membership ↗</span></div><div class="finance-products"><div><b>01</b><strong>Everyday</strong><span>Room to live.</span></div><div><b>02</b><strong>Tomorrow</strong><span>Room to grow.</span></div><div><b>03</b><strong>Together</strong><span>Room to build.</span></div></div>`,
    );
  return browser(
    t,
    `<div class="site-nav"><b>${t.short}</b><span>WORK / PRACTICE / CONTACT</span></div><div class="studio-hero"><span class="site-kicker">AN INDEPENDENT DESIGN PRACTICE</span><h2>${heading}</h2><p>${t.subline}</p></div><div class="studio-index"><div><span>01</span><strong>The Common Ground</strong><small>PUBLIC / 2026</small></div><div><span>02</span><strong>A House for Everyone</strong><small>RESIDENTIAL / 2025</small></div><div><span>03</span><strong>Between the Lines</strong><small>URBAN / 2026</small></div></div>`,
  );
}

function recon(s: Snapshot, t: Target): string {
  const found = s.objectives
    .filter((o) => o.id.startsWith('foothold.') && o.state !== 'hidden')
    .map((o) => o.id.split('.')[1]);
  const visible = Math.min(t.endpoints.length, 2 + Math.floor(s.stageMs / 2200));
  const rows = t.endpoints.slice(0, visible).map((ep) => {
    const discovered = found.includes(ep.entry);
    return `<div class="endpoint-row ${discovered ? 'matched' : ''}" data-key="${ep.path}"><span class="method">GET</span><code>${esc(ep.path)}</code><span class="endpoint-type">${esc(ep.kind)}</span><span class="endpoint-mark" aria-label="${tr(s, discovered ? 'Discovered entrance' : 'Undiscovered entrance', discovered ? 'כניסה שהתגלתה' : 'כניסה שטרם התגלתה')}">${discovered ? '◆' : '·'}</span></div>`;
  }).join('');
  return `<div class="recon-grid">${website(t)}${panel(tr(s, 'Endpoints', 'נקודות קצה'), tr(s, `${found.length}/5 entrances found`, `${found.length}/5 כניסות התגלו`), `<div class="endpoint-list">${rows}</div><div class="scan-status"><i></i><span>${tr(s, 'Mapping the surface', 'מיפוי משטח התקיפה')}</span></div>`, 'scanner')}</div>`;
}

function access(s: Snapshot, t: Target, id: string): string {
  const e = id.slice(7) as EntryId;
  const ep = t.endpoints.find((x) => x.entry === e)!;
  const live = !!s.player?.inside || done(s, `foothold.${e}`);
  const status = live
    ? tr(s, 'Access established', 'הגישה הושגה')
    : s.player?.hidden || s.interaction
      ? tr(s, 'In progress', 'בתהליך')
      : tr(s, 'Entry found', 'כניסה התגלתה');
  const progress = s.interaction?.kind === 'lockpick'
    ? `<div class="access-progress">${bar(s.interaction.progress)}<span>${percent(s.interaction.progress)}%</span>${s.interaction.jammed ? tag(tr(s, 'Detected', 'זוהה'), 'red') : ''}</div>` : '';
  let body = '';
  if (e === 'front')
    body = `<div class="phishing-scene"><section class="mail-window"><div class="mail-toolbar">INBOX<span>${esc(t.name)}</span></div><div class="mail-message"><h2>Review your<br>workspace access.</h2><div class="mail-sender"><b>IT Service Desk</b><span>access@${t.domain}</span></div><p>Please review your access before the end of your shift.</p><span class="mail-cta">Review access ↗</span></div></section><div class="handoff-label" aria-hidden="true"><span>→</span></div><section class="identity-window"><span class="id-symbol">◈</span><h3>${t.short} / IDENTITY</h3><p>Sign in to your workspace</p><div class="fake-field">${t.account}@${t.domain}</div><div class="fake-field password">••••••••••••</div><span class="fake-signin">${live ? 'Session accepted' : 'Sign in'}</span></section></div>`;
  if (e === 'side')
    body = panel(tr(s, 'Patch gap', 'פער עדכונים'), '',
      `<div class="legacy-heading"><span class="large-index">v1</span><h2>${esc(ep.path)}</h2></div><div class="release-compare"><section><span>DEPLOYED</span><h3>1.8.2</h3>${tag('VULNERABLE', 'red')}</section><div class="patch-gap">→</div><section><span>AVAILABLE</span><h3>1.9.0</h3>${tag('PATCHED', 'green')}</section></div>`, 'legacy-scene');
  if (e === 'dock')
    body = panel(tr(s, 'Supplier delivery', 'משלוח ספק'), '',
      `<div class="pipeline-title"><h2>${esc(t.vendor)}</h2></div><div class="pipeline">${['VENDOR', 'SIGNED PACKAGE', 'TRUSTED CONNECTOR', t.services[0].toUpperCase()].map((step, i) => `<div class="pipeline-step ${s.player?.hidden || live ? 'active' : ''}"><b>0${i + 1}</b><span>${esc(step)}</span></div>`).join('')}</div><div class="artifact-package"><span class="package-code">PKG</span><div><b>${t.short.toLowerCase()}-connector.update</b><code>${esc(t.vendor)} → internal/workspace</code></div><span class="package-travel ${s.player?.hidden ? 'moving' : ''}">→</span></div>`, 'supply-scene');
  if (e === 'vent')
    body = panel(tr(s, 'Edge gateway', 'שער גישה'), '',
      `<div class="gateway-grid"><section class="gateway-console"><h2>${esc(t.short)}<br>EDGE / 03</h2><div class="appliance-slots">${[0, 1, 2, 3].map((i) => `<div><b>PORT 0${i + 1}</b><i class="${i === 2 ? 'exposed' : ''}"></i><span>${i === 2 ? 'EXPOSED' : 'MANAGED'}</span></div>`).join('')}</div></section><section class="maintenance"><h3>Maintenance</h3><div><span>Gateway update</span><small class="text-red">OVERDUE</small></div><div class="gateway-path"><code>PUBLIC</code><span>↓</span><code>${esc(ep.path)}</code><span>↓</span><code class="${live ? 'text-green' : ''}">INTERNAL</code></div></section></div>`, 'gateway-scene');
  if (e === 'sewer')
    body = panel(tr(s, 'Unexpected API behavior', 'התנהגות API בלתי צפויה'), '',
      `<div class="contract-heading"><code>${esc(ep.path)}</code></div><div class="contract-diff"><section><span>EXPECTED</span><pre>{\n  "scope": "public",\n  "identity": "required",\n  "access": "restricted"\n}</pre></section><section class="anomaly"><span>OBSERVED</span><pre>{\n  "scope": "${live ? 'internal' : 'unknown'}",\n  "identity": "unresolved",\n  "access": "${live ? 'granted' : 'under inspection'}"\n}</pre></section></div><div class="anomaly-trace"><svg viewBox="0 0 700 90" role="img" aria-label="Unexpected response"><path d="M0 65 H110 V61 H210 V64 H290 V62 H345 V15 H358 V74 H371 V28 H382 V66 H430 V63 H540 V65 H700"/></svg></div>`, 'zero-scene');
  return `<div class="access-grid"><div class="access-summary"><b>${esc(entryLabels[e])}</b><code>${esc(ep.path)}</code>${tag(status, live ? 'green' : 'amber')}${progress}</div>${body}</div>`;
}

function topology(s: Snapshot, t: Target, small = false): string {
  const reached = !!s.player?.inside;
  const card = !!s.player?.card;
  const vault = !!s.player?.breached;
  const nodes = [
    { x: 90, y: 180, label: 'PUBLIC EDGE', active: true },
    { x: 275, y: 110, label: t.services[0], active: reached },
    { x: 275, y: 260, label: 'IDENTITY', active: card },
    { x: 490, y: 110, label: t.services[1], active: card },
    { x: 490, y: 260, label: 'MONITORING', active: !s.security.camerasDown },
    { x: 695, y: 180, label: t.services[2], active: vault },
  ];
  return `<div class="topology ${small ? 'compact' : ''}"><svg viewBox="0 0 790 350" role="img" aria-label="Internal trust relationships"><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#2d3b4c"/></pattern></defs><rect width="790" height="350" fill="url(#grid)"/><rect class="trust-zone" x="172" y="32" width="600" height="300" rx="8"/><text class="zone-label" x="190" y="53">INTERNAL TRUST BOUNDARY</text>${[
    [0, 1],
    [0, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 5],
    [4, 5],
  ]
    .map(
      ([a, b]) =>
        `<path class="network-edge ${nodes[b].active ? 'lit' : ''}" d="M${nodes[a].x} ${nodes[a].y} C${(nodes[a].x + nodes[b].x) / 2} ${nodes[a].y},${(nodes[a].x + nodes[b].x) / 2} ${nodes[b].y},${nodes[b].x} ${nodes[b].y}"/>`,
    )
    .join(
      '',
    )}${nodes.map((n, i) => `<g class="network-node ${n.active ? 'lit' : ''} ${i === 4 && s.security.camerasDown ? 'offline' : ''}"><rect x="${n.x - 30}" y="${n.y - 25}" width="60" height="50" rx="8"/><text class="node-symbol" x="${n.x}" y="${n.y + 7}">${['↗', '▤', '◈', '⊞', '≋', '▥'][i]}</text><text class="node-label" x="${n.x}" y="${n.y + 48}">${esc(n.label)}</text><text class="node-status" x="${n.x}" y="${n.y + 67}">${i === 4 ? (s.security.camerasDown ? 'SILENT' : 'RECEIVING') : n.active ? 'REACHABLE' : 'RESTRICTED'}</text></g>`).join('')}</svg></div>`;
}

function waveform(s: Snapshot, mode: 'power' | 'drill'): string {
  const off = mode === 'power' && s.security.camerasDown;
  const heat = mode === 'drill' ? (s.interaction?.heat ?? 0) : 0.45;
  const values = Array.from({ length: 91 }, (_, i) => {
    const v = off
      ? 0
      : (Math.sin(i * 0.69 + s.tick * 0.11) * 0.45 +
          Math.sin(i * 1.97 + s.tick * 0.08) * 0.2 +
          Math.sin(i * 0.21) * 0.28) *
        (14 + heat * 72);
    return `${i * 8},${95 - v}`;
  });
  return `<svg class="waveform ${off ? 'silent' : ''} ${heat > 0.75 ? 'hot' : ''}" viewBox="0 0 720 190" role="img" aria-label="${mode === 'power' ? 'Monitoring signal' : 'Outbound channel noise'}"><path class="scope-grid" d="M0 47H720M0 95H720M0 143H720M120 0V190M240 0V190M360 0V190M480 0V190M600 0V190"/><path class="threshold" d="M0 30H720"/><text x="575" y="23">${mode === 'drill' ? 'DETECTION THRESHOLD' : 'SIGNAL CEILING'}</text><polyline class="scope-signal" points="${values.join(' ')}"/></svg>`;
}

function lateral(s: Snapshot, t: Target, id: string): string {
  let focus = '';
  if (id === 'lateral-card')
    focus = panel(tr(s, 'Credentials', 'הרשאות'), tr(s, 'Acquired', 'הושגו'),
      `<div class="credential"><div class="credential-owner"><span class="avatar">${t.account.slice(0, 2).toUpperCase()}</span><div><h2>${esc(t.account)}</h2><span>${esc(t.name)}</span></div>${tag('VALID', 'green')}</div><div class="permission-matrix"><div><b>RESOURCE</b><b>BEFORE</b><b>NOW</b></div>${t.services.map((name) => `<div><span>${esc(name)}</span><span class="text-muted">DENY</span><span class="text-green">ALLOW</span></div>`).join('')}</div></div>`, 'identity-scene');
  else if (id === 'lateral-power')
    focus = panel(tr(s, 'Monitoring', 'ניטור'), s.security.camerasDown ? tr(s, 'Offline', 'מנותק') : tr(s, 'Connected', 'מחובר'),
      `${waveform(s, 'power')}<div class="telemetry-feeds">${['Gateway', 'Authentication', 'Cameras'].map((n, i) => `<div><b>${n}</b><span class="${s.security.camerasDown ? 'text-red' : 'text-cyan'}">${s.security.camerasDown ? 'NO SIGNAL' : s.interaction?.kind === 'wire' && i < percent(s.interaction.progress) / 34 ? 'INTERRUPTED' : 'RECEIVING'}</span></div>`).join('')}</div>${s.interaction?.kind === 'wire' ? `<div class="attempt-progress"><span>${percent(s.interaction.progress)}%</span>${bar(s.interaction.progress)}${s.interaction.jammed ? tag('NOISE DETECTED', 'red') : ''}</div>` : ''}`, 'power-scene');
  else if (id === 'lateral-uniform')
    focus = panel(tr(s, 'Processes', 'תהליכים'), tr(s, 'Disguise active', 'הסוואה פעילה'),
      `<div class="process-table"><div class="process-row head"><span>PID</span><span>PROCESS</span><span>IDENTITY</span><span>POLICY</span></div>${[
        ['0408', 'system-agent', 'LOCAL SERVICE', 'ALLOW'],
        ['0812', 'workspace-sync', t.account, 'ALLOW'],
        ['1024', 'trusted-helper', 'BORROWED', s.security.alarm ? 'ALERT' : 'TRUSTED'],
        ['1336', 'event-forwarder', 'LOCAL SERVICE', s.security.camerasDown ? 'OFFLINE' : 'ALLOW'],
      ].map((row, i) => `<div class="process-row ${i === 2 ? 'borrowed' : ''}">${row.map((v) => `<span>${esc(v)}</span>`).join('')}</div>`).join('')}</div>`, 'process-scene');
  else
    focus = panel(tr(s, 'Network', 'רשת'), '', `${topology(s, t)}<div class="lateral-evidence">${tag(s.player?.card ? tr(s, 'Credentials acquired', 'הרשאות הושגו') : tr(s, 'Credentials needed', 'נדרשות הרשאות'), s.player?.card ? 'green' : '')}${tag(s.player?.disguised ? tr(s, 'Disguised', 'מוסווה') : tr(s, 'Visible', 'גלוי'), s.player?.disguised ? 'violet' : '')}${tag(s.security.camerasDown ? tr(s, 'Monitoring off', 'ניטור כבוי') : tr(s, 'Monitoring on', 'ניטור פעיל'), s.security.camerasDown ? 'red' : 'cyan')}</div>`, 'network-scene');
  return `<div class="lateral-grid">${focus}</div>`;
}

function exfil(s: Snapshot, t: Target): string {
  const n = s.exfil.needed || 3, loads = s.exfil.loads;
  const drilling = s.interaction?.kind === 'drill';
  return `<div class="exfil-grid">${panel(tr(s, 'Archive', 'ארכיון'), t.services[2],
    `<div class="archive-files">${t.datasets.map((name, i) => `<div class="archive-file ${loads > i ? 'sent' : s.player?.carrying && loads === i ? 'carried' : ''}"><span class="file-type">${name.split('.').pop()?.slice(0, 4).toUpperCase()}</span><div><strong>${esc(name)}</strong><small>${loads > i ? 'DELIVERED' : s.player?.carrying && loads === i ? 'IN TRANSIT' : 'AT SOURCE'}</small></div><b>${loads > i ? '✓' : s.player?.carrying && loads === i ? '↗' : '▥'}</b></div>`).join('')}</div>`, 'archive-panel')}${panel(tr(s, 'Outbound channel', 'ערוץ יוצא'), s.interaction?.jammed ? tr(s, 'Jammed', 'תקוע') : s.exfil.hole ? tr(s, 'Open', 'פתוח') : drilling ? tr(s, 'Opening', 'נפתח') : tr(s, 'Closed', 'סגור'),
    `${waveform(s, 'drill')}<div class="scope-stats">${stat(tr(s, 'Channel', 'ערוץ'), `${percent(s.exfil.channelProgress)}%`)}${stat(tr(s, 'Noise', 'רעש'), drilling ? `${percent(s.interaction!.heat)}%` : '—', s.interaction?.jammed ? 'danger' : '')}</div>${bar(s.exfil.channelProgress)}`, 'scope-panel')}${panel(tr(s, 'Receiver', 'שרת קולט'), s.exfil.van ? tr(s, 'Ready', 'מוכן') : tr(s, 'Waiting', 'ממתין'),
    `<div class="receiver"><div class="receiver-name"><span class="server-icon">▤</span><div><b>relay-${esc(s.operator.toLowerCase())}.example</b></div></div><div class="packet-pipe ${s.player?.carrying && s.exfil.van ? 'flowing' : ''}" aria-label="Transfer"><span>→</span><i></i><i></i><i></i><span>▤</span></div><div class="delivery-count"><strong>${loads}<small>/${n}</small></strong><span>${tr(s, 'delivered', 'נמסרו')}</span></div>${bar(loads / n)}</div>`, 'receiver-panel')}</div>`;
}

function alertText(s: Snapshot, item: JournalEvent): string {
  switch (item.event.kind) {
    case 'caught': return tr(s, 'Intruder caught', 'התוקף נתפס');
    case 'alarm': return tr(s, 'Alarm raised', 'אזעקה הופעלה');
    case 'drillJam': return tr(s, 'Channel jammed', 'הערוץ נתקע');
    case 'wireShort': return tr(s, 'Noise detected', 'רעש זוהה');
    default: return '';
  }
}

/** Idle packets keep the connection alive without rebuilding the waiting screen. */
export function frameKey(s: DisplaySnapshot): string {
  return s.state === 'round1' || 'defense' in s ? `${s.run}:${s.seq}` : `standby:${s.language}`;
}

export function renderSnapshot(s: DisplaySnapshot): string {
  if ('defense' in s) return renderDefense(s);
  if (s.state !== 'round1')
    return `<section class="waiting" data-scene="standby" data-key="standby" dir="${s.language === 'he' ? 'rtl' : 'ltr'}"><h1>${tr(s, 'Waiting for the next round.', 'ממתינים לסיבוב הבא.')}</h1><p>${tr(s, 'Continue on the game screen. This board follows automatically.', 'המשיכו במסך המשחק. הלוח מתעדכן אוטומטית.')}</p></section>`;
  const target = targetAt(s.target), id = sceneId(s);
  const phase = id === 'recon' ? 0 : id.startsWith('access-') ? 1 : id.startsWith('lateral') ? 2 : 3;
  const [, en, he] = phaseLabels[phase];
  const alert = recent(s, ['caught', 'alarm', 'drillJam', 'wireShort'], 60);
  const content = id === 'recon' ? recon(s, target)
    : id.startsWith('access-') ? access(s, target, id)
    : id.startsWith('lateral') ? lateral(s, target, id) : exfil(s, target);
  return `<div class="operation" data-scene="${id}" data-key="${id}" style="--target-color:${target.color}"><div class="operation-top"><div class="target-lockup"><span class="target-mark">${esc(target.short.slice(0, 2))}</span><div><b>${esc(target.name)}</b><span>${esc(target.domain)}</span></div></div><div class="phase-indicator" dir="${s.language === 'he' ? 'rtl' : 'ltr'}"><span class="phase-dots" aria-hidden="true">${phaseLabels.map((_, i) => `<i class="${i === phase ? 'active' : i < phase ? 'complete' : ''}"></i>`).join('')}</span><h1>${esc(tr(s, en, he))}</h1></div><div class="operation-meta"><span>${esc(s.operator.toUpperCase())}</span><b>${clock(s.stageMs)}</b></div></div><div class="scene-content">${content}</div>${alert ? `<div class="live-alert" role="status">${esc(alertText(s, alert))}</div>` : ''}</div>`;
}
