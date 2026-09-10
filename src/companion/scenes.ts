import type {
  EntryId,
  JournalEvent,
  ThiefSnapshot as Snapshot,
  Snapshot as DisplaySnapshot,
} from './protocol';
import { targetAt, type Target } from './targets';

export const esc = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
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
const gameEntryLabels: Record<EntryId, string> = {
  front: 'Front doors',
  side: 'Side door',
  dock: 'Supplier’s truck',
  vent: 'Roof vent',
  sewer: 'Sewer hatch',
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

interface SceneCopy {
  title: string;
  subtitle: string;
  chapter: string;
  link: string;
}
function copy(s: Snapshot, id: string): SceneCopy {
  if (id === 'recon')
    return {
      title: tr(s, 'Every system leaves a trace.', 'כל מערכת משאירה עקבות.'),
      subtitle: tr(
        s,
        'The perimeter becomes a map of public services, people, and forgotten entry points.',
        'היקף הבניין הופך למפה של שירותים ציבוריים, אנשים ונקודות כניסה שנשכחו.',
      ),
      chapter: '01 / RECONNAISSANCE',
      link: tr(
        s,
        'Walking around the bank → mapping an organization’s public attack surface',
        'סיור סביב הבנק ← מיפוי משטח התקיפה הציבורי של הארגון',
      ),
    };
  if (id.startsWith('access-'))
    return {
      title: tr(
        s,
        {
          front: 'An invitation to trust.',
          side: 'Yesterday’s flaw. Today’s way in.',
          dock: 'The delivery is already trusted.',
          vent: 'The gateway nobody updated.',
          sewer: 'A response nobody expected.',
        }[s.focusEntry],
        {
          front: 'הזמנה לתת אמון.',
          side: 'החולשה של אתמול. הכניסה של היום.',
          dock: 'המשלוח כבר נחשב מהימן.',
          vent: 'השער שאיש לא עדכן.',
          sewer: 'תגובה שאיש לא ציפה לה.',
        }[s.focusEntry],
      ),
      subtitle: tr(
        s,
        'One entrance. One different kind of failure. The attempt follows the player.',
        'כניסה אחת, סוג אחר של כשל. הניסיון מתקדם לפי פעולות השחקן.',
      ),
      chapter: '02 / INITIAL ACCESS',
      link: `${gameEntryLabels[s.focusEntry]} → ${entryLabels[s.focusEntry]}`,
    };
  if (id.startsWith('lateral'))
    return {
      title: tr(
        s,
        id === 'lateral-card'
          ? 'The permission is real. The user isn’t.'
          : id === 'lateral-power'
            ? 'The sensors fall silent.'
            : id === 'lateral-uniform'
              ? 'A familiar face in the process list.'
              : 'Inside is only the beginning.',
        id === 'lateral-card'
          ? 'ההרשאה אמיתית. המשתמש מתחזה.'
          : id === 'lateral-power'
            ? 'החיישנים משתתקים.'
            : id === 'lateral-uniform'
              ? 'זהות מוכרת ברשימת התהליכים.'
              : 'הכניסה היא רק ההתחלה.',
      ),
      subtitle: tr(
        s,
        'Move between services. Borrow an identity. Reach the information that matters.',
        'מעבר בין שירותים, שימוש בזהות גנובה והגעה למידע החשוב.',
      ),
      chapter: '03 / LATERAL MOVEMENT',
      link: tr(
        s,
        'Uniform → evasion · manager’s card → credentials · fuse box → disabled monitoring',
        'מדים ← התחמקות · כרטיס המנהל ← הרשאות · נתיכים ← השבתת ניטור',
      ),
    };
  if (id === 'exfil')
    return {
      title: tr(
        s,
        'Access is a foothold. Data is the prize.',
        'הגישה היא נקודת אחיזה. המידע הוא הפרס.',
      ),
      subtitle: tr(
        s,
        'Open a channel. Keep the noise down. Get the archive beyond the boundary.',
        'פתיחת ערוץ, צמצום הרעש והעברת הארכיון אל מחוץ לגבול.',
      ),
      chapter: '04 / DATA EXFILTRATION',
      link: tr(
        s,
        'Drill → outbound channel · cash → sensitive data · van → receiving server',
        'מקדחה ← ערוץ יוצא · כסף ← מידע רגיש · רכב מילוט ← שרת קולט',
      ),
    };
  throw new Error(`Unknown thief scene: ${id}`);
}

function phaseRail(s: Snapshot): string {
  const idx = phaseLabels.findIndex((p) => p[0] === s.phase);
  return `<nav class="phase-rail" aria-label="Mission phases">${phaseLabels.map(([key, en, he], i) => `<span class="${idx === i ? 'active' : idx > i ? 'complete' : ''}"><b>${idx > i ? '✓' : `0${i + 1}`}</b>${esc(tr(s, en, he))}</span>`).join('')}</nav>`;
}

function browser(t: Target, body: string): string {
  return `<section class="fictional-browser"><div class="browser-chrome"><span class="window-dots"><i></i><i></i><i></i></span><span class="address">◈ &nbsp; ${t.domain}</span><span class="browser-label">SIMULATED WEBSITE</span></div><div class="public-site site-${t.style}" style="--site-color:${t.color}">${body}</div></section>`;
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
  const visible = Math.min(
    t.endpoints.length,
    2 + Math.floor(s.stageMs / 2200),
  );
  const scan = Math.floor(s.tick / 8);
  const rows = t.endpoints
    .slice(0, visible)
    .map(
      (ep, i) =>
        `<div class="endpoint-row ${found.includes(ep.entry) ? 'matched' : ''}" data-key="${ep.path}"><span class="method">GET</span><code>${esc(ep.path)}</code><span class="endpoint-type">${esc(ep.kind)}</span><span class="endpoint-mark">${found.includes(ep.entry) ? '◆' : '·'}</span></div>`,
    )
    .join('');
  return `<div class="recon-grid">${website(t)}<div class="recon-tools">${panel('SURFACE / DISCOVERY', `PASS ${String(Math.floor(scan / 8) + 1).padStart(3, '0')}`, `<div class="scan-target"><span>scope</span><code>*.${t.domain}</code>${tag('PASSIVE ENUMERATION', 'cyan')}</div><div class="endpoint-head"><span>METHOD</span><span>ENDPOINT</span><span>CLASS</span></div><div class="endpoint-list">${rows}</div><div class="terminal-tail"><span>›</span><code>${esc(['Reading public route index', 'Correlating service names', 'Following published references', 'Checking service metadata'][scan % 4])}<b class="cursor">_</b></code></div><p class="artifact-note">${tr(s, 'Illustrative endpoint traffic · no requests leave this game', 'תעבורת המחשה · לא נשלחות בקשות מהמשחק')}</p>`, 'scanner')}${panel(tr(s, 'WHAT THE PLAYER HAS FOUND', 'מה השחקן גילה'), 'LIVE EVIDENCE', `<div class="discovery-ledger">${(['front', 'side', 'dock', 'vent', 'sewer'] as EntryId[]).map((e) => `<div class="${found.includes(e) ? 'found' : ''}"><span>${found.includes(e) ? '◆' : '◇'}</span><b>${found.includes(e) ? esc(entryLabels[e]) : tr(s, 'Unmapped surface', 'משטח שטרם מופה')}</b><small>${found.includes(e) ? esc(gameEntryLabels[e]) : '—'}</small></div>`).join('')}</div><div class="scan-count">${stat(tr(s, 'ENTRANCES DISCOVERED', 'כניסות שהתגלו'), `${found.length} / 5`)}${stat(tr(s, 'PERIMETER SURVEY', 'סקירת היקף'), done(s, 'recon.circle') ? 'COMPLETE' : 'IN PROGRESS')}</div>`, 'evidence-panel')}</div></div>`;
}

function access(s: Snapshot, t: Target, id: string): string {
  const e = id.slice(7) as EntryId;
  const ep = t.endpoints.find((x) => x.entry === e)!;
  const live = !!s.player?.inside || done(s, `foothold.${e}`);
  const status = live
    ? 'ACCESS ESTABLISHED'
    : s.player?.hidden
      ? 'CROSSING TRUST BOUNDARY'
      : s.interaction
        ? 'ATTEMPT IN PROGRESS'
        : 'SURFACE IDENTIFIED';
  const signal = panel(
    'ACCESS TELEMETRY',
    'GAME → CYBER',
    `<div class="access-status">${tag(status, live ? 'green' : 'amber')}<h3>${entryLabels[e]}</h3><p>${tr(s, 'The outcome changes only when the player acts in the bank.', 'התוצאה משתנה רק כשהשחקן פועל בבנק.')}</p></div><dl class="detail-list"><div><dt>Target service</dt><dd>${esc(ep.path)}</dd></div><div><dt>Trust boundary</dt><dd>PUBLIC → INTERNAL</dd></div><div><dt>Game entrance</dt><dd>${esc(gameEntryLabels[e])}</dd></div><div><dt>Operator</dt><dd>${esc(s.operator)}</dd></div></dl>${s.interaction?.kind === 'lockpick' ? `<div class="attempt-progress"><span>ACCESS CHECKS ${percent(s.interaction.progress)}%</span>${bar(s.interaction.progress)}${s.interaction.jammed ? tag('ATTEMPT NOTICED', 'red') : ''}</div>` : ''}<p class="access-lesson">${tr(s, { front: 'A trusted-looking message can turn a person into the entry point.', side: 'A published fix only helps the systems that actually receive it.', dock: 'Trust granted to a supplier can become access granted to an attacker.', vent: 'An exposed service inherits every update that was left undone.', sewer: 'An unexpected behavior can open a path that no signature recognizes.' }[e], { front: 'הודעה שנראית אמינה יכולה להפוך אדם לנקודת הכניסה.', side: 'תיקון שפורסם עוזר רק למערכות שבאמת קיבלו אותו.', dock: 'אמון שניתן לספק יכול להפוך לגישה שניתנת לתוקף.', vent: 'שירות חשוף נשאר עם כל העדכונים שלא הותקנו.', sewer: 'התנהגות בלתי צפויה יכולה לפתוח מסלול שאף חתימה אינה מזהה.' }[e])}</p>`,
    'access-sidebar',
  );
  let body = '';
  if (e === 'front')
    body = `<div class="phishing-scene"><section class="mail-window"><div class="mail-toolbar">MAILBOX / ${esc(t.name)}<span>INBOX 07</span></div><div class="mail-message"><span class="mail-category">ACTION REQUIRED</span><h2>Your workspace access<br>needs a quick review.</h2><div class="mail-sender"><b>IT Service Desk</b><span>access@${t.domain}</span><small>TO: ${t.account}</small></div><p>We’re updating the workspace directory. Please review your access before the end of your shift.</p><span class="mail-cta">Review workspace access ↗</span><p class="mail-signoff">Thank you,<br>The Workplace Team</p></div></section><div class="handoff-label">IDENTITY HANDOFF <span>→</span></div><section class="identity-window"><span class="id-symbol">◈</span><h3>${t.short} / IDENTITY</h3><p>Continue to your workspace</p><div class="fake-field">${t.account}@${t.domain}</div><div class="fake-field password">••••••••••••</div><span class="fake-signin">${live ? 'Session accepted' : 'Awaiting the visitor'}</span><div class="identity-stamp">${live ? 'TRUST BOUNDARY CROSSED' : 'A FAMILIAR SIGN-IN. A DIFFERENT DESTINATION.'}</div></section></div>`;
  if (e === 'side')
    body = panel(
      'LEGACY SERVICE / PATCH GAP',
      'SERVICE INSPECTOR',
      `<div class="legacy-heading"><span class="large-index">v1</span><div><span>STILL IN PRODUCTION</span><h2>${esc(ep.path)}</h2><p>Compatibility endpoint / maintained outside the current release</p></div></div><div class="release-compare"><section><span>DEPLOYED</span><h3>1.8.2</h3><code>access-check: legacy</code>${tag('UPDATE OVERDUE', 'red')}</section><div class="patch-gap">PATCH<br>GAP</div><section><span>AVAILABLE</span><h3>1.9.0</h3><code>access-check: revised</code>${tag('FIX PUBLISHED', 'green')}</section></div><div class="release-history"><div><time>RELEASE 018</time><b>Legacy compatibility retained</b><span>DEPLOYED</span></div><div><time>ADVISORY 042</time><b>Access boundary issue documented</b><span>REVIEWED</span></div><div><time>RELEASE 019</time><b>Boundary validation corrected</b><span class="text-red">NOT INSTALLED</span></div></div><div class="probe-strip"><span>REQUEST VALIDATION</span>${[0, 1, 2, 3, 4, 5].map((i) => `<i class="${s.interaction && i < Math.round(s.interaction.progress * 6) ? 'passed' : ''}"></i>`).join('')}<b>${live ? 'ACCEPTED' : 'TESTING'}</b></div>`,
      'legacy-scene',
    );
  if (e === 'dock')
    body = panel(
      'TRUSTED ARTIFACT / DELIVERY PIPELINE',
      'SUPPLIER INTEGRATION',
      `<div class="pipeline-title"><span>VENDOR</span><h2>${esc(t.vendor)}</h2><p>A routine update has permission to cross the perimeter.</p></div><div class="pipeline">${['VENDOR BUILD', 'SIGNED PACKAGE', 'TRUSTED CONNECTOR', t.services[0].toUpperCase()].map((step, i) => `<div class="pipeline-step ${s.player?.hidden || live ? 'active' : ''}"><b>0${i + 1}</b><span>${esc(step)}</span><i>${i === 0 ? 'PACKAGE CREATED' : i === 1 ? 'SIGNATURE TRUSTED' : i === 2 ? 'ACCESS ALLOWED' : live ? 'DELIVERED' : 'AWAITING DELIVERY'}</i></div>`).join('')}</div><div class="artifact-package"><span class="package-code">PKG</span><div><b>${t.short.toLowerCase()}-connector.update</b><code>issuer: ${esc(t.vendor)}<br>destination: internal/workspace<br>policy: inherited vendor trust</code></div><span class="package-travel ${s.player?.hidden ? 'moving' : ''}">→</span></div><div class="trust-note"><b>${s.player?.hidden ? 'RIDING INSIDE A TRUSTED DELIVERY' : live ? 'THE VENDOR PATH REACHED THE NETWORK' : 'WAITING FOR THE DELIVERY VEHICLE'}</b><span>TRUCK STATE IS LIVE · PACKAGE IS ILLUSTRATIVE</span></div>`,
      'supply-scene',
    );
  if (e === 'vent')
    body = panel(
      'EDGE GATEWAY / MAINTENANCE DEBT',
      'EXPOSED SERVICE',
      `<div class="gateway-grid"><section class="gateway-console"><span class="eyebrow">REMOTE ACCESS APPLIANCE</span><h2>${esc(t.short)}<br>EDGE / 03</h2><div class="appliance-slots">${[0, 1, 2, 3, 4, 5].map((i) => `<div><b>PORT 0${i + 1}</b><i class="${i === 2 ? 'exposed' : ''}"></i><span>${i === 2 ? 'PUBLICLY REACHABLE' : 'MANAGED'}</span></div>`).join('')}</div>${tag(live ? 'TUNNEL ESTABLISHED' : 'LISTENING AT THE PERIMETER', 'cyan')}</section><section class="maintenance"><h3>Maintenance queue</h3><div><b>01</b><span>Rotate edge certificate</span><small>DONE</small></div><div><b>02</b><span>Update gateway service</span><small class="text-red">DEFERRED</small></div><div><b>03</b><span>Validate access policy</span><small>WAITING</small></div><div class="gateway-path"><code>PUBLIC</code><span>↓</span><code>${esc(ep.path)}</code><span>↓</span><code class="${live ? 'text-green' : ''}">INTERNAL SESSION</code></div></section></div>`,
      'gateway-scene',
    );
  if (e === 'sewer')
    body = panel(
      'API CONTRACT / UNEXPECTED BEHAVIOR',
      'UNCLASSIFIED SURFACE',
      `<div class="contract-heading"><span class="tag violet">NO KNOWN SIGNATURE</span><h2>An assumption<br>breaks at the boundary.</h2><code>${esc(ep.path)}</code></div><div class="contract-diff"><section><span>DOCUMENTED CONTRACT</span><pre>{\n  "scope": "public",\n  "identity": "required",\n  "response": "restricted"\n}</pre></section><section class="anomaly"><span>OBSERVED BEHAVIOR</span><pre>{\n  "scope": "${live ? 'internal' : 'unclassified'}",\n  "identity": "unresolved",\n  "boundary": "${live ? 'crossed' : 'under inspection'}"\n}</pre></section></div><div class="anomaly-trace"><span>RESPONSE PATTERN</span><svg viewBox="0 0 700 90" role="img" aria-label="Illustrative anomalous response"><path d="M0 65 H110 V61 H210 V64 H290 V62 H345 V15 H358 V74 H371 V28 H382 V66 H430 V63 H540 V65 H700"/></svg><b>UNEXPECTED BRANCH</b></div>`,
      'zero-scene',
    );
  return `<div class="access-grid">${body}${signal}</div>`;
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
    focus = panel(
      'IDENTITY / PERMISSION MANIFEST',
      'CREDENTIAL ACQUIRED',
      `<div class="credential"><div class="credential-owner"><span class="avatar">${t.account.slice(0, 2).toUpperCase()}</span><div><small>ACTIVE PRINCIPAL</small><h2>${esc(t.account)}</h2><span>${esc(t.name)}</span></div>${tag('VALID IDENTITY', 'green')}</div><div class="permission-matrix"><div><b>RESOURCE</b><b>BEFORE</b><b>WITH CREDENTIAL</b></div>${t.services.map((name) => `<div><span>${esc(name)}</span><span class="text-muted">DENY</span><span class="text-green">ALLOW</span></div>`).join('')}</div><div class="credential-token"><span>SESSION CONTEXT / ILLUSTRATIVE</span><code>principal: ${t.account}<br>role: resource-owner<br>actor: ${esc(s.operator.toLowerCase())}<br>identity_check: valid &nbsp; · &nbsp; intent: unverified</code></div></div>`,
      'identity-scene',
    );
  else if (id === 'lateral-power')
    focus = panel(
      'SECURITY TELEMETRY / SIGNAL CONTROL',
      s.security.camerasDown
        ? 'SENSOR STREAM LOST'
        : 'INTERRUPTION IN PROGRESS',
      `<div class="power-heading"><h2>${s.security.camerasDown ? 'A blind spot<br>opens up.' : 'Cutting the signal.'}</h2>${tag(s.security.camerasDown ? 'MONITORING SILENT' : 'SENSORS CONNECTED', s.security.camerasDown ? 'red' : 'cyan')}</div>${waveform(s, 'power')}<div class="telemetry-feeds">${['Gateway events', 'Authentication logs', 'Camera coverage'].map((n, i) => `<div><b>${n}</b><span class="${s.security.camerasDown ? 'text-red' : 'text-cyan'}">${s.security.camerasDown ? 'NO SIGNAL' : s.interaction?.kind === 'wire' && i < percent(s.interaction.progress) / 34 ? 'INTERRUPTED' : 'RECEIVING'}</span></div>`).join('')}</div>${s.interaction?.kind === 'wire' ? `<div class="attempt-progress"><span>SIGNAL INTERRUPTION ${percent(s.interaction.progress)}%</span>${bar(s.interaction.progress)}${s.interaction.jammed ? tag('NOISE DETECTED', 'red') : ''}</div>` : ''}<p class="artifact-note">Fuse box → reduced security visibility. Guard patrols remain active.</p>`,
      'power-scene',
    );
  else if (id === 'lateral-uniform')
    focus = panel(
      'ENDPOINT / PROCESS IDENTITY',
      'EVASION IN PROGRESS',
      `<div class="process-heading"><h2>It looks like<br>it belongs here.</h2>${tag('TRUSTED APPEARANCE', 'violet')}</div><div class="process-table"><div class="process-row head"><span>PID</span><span>PROCESS</span><span>IDENTITY</span><span>POLICY</span></div>${[
        ['0408', 'system-agent', 'LOCAL SERVICE', 'ALLOW'],
        ['0812', 'workspace-sync', t.account, 'ALLOW'],
        ['1024', 'trusted-helper', 'STAFF / BORROWED', 'REDUCED SCRUTINY'],
        [
          '1336',
          'event-forwarder',
          'LOCAL SERVICE',
          s.security.camerasDown ? 'OFFLINE' : 'ALLOW',
        ],
      ]
        .map(
          (row, i) =>
            `<div class="process-row ${i === 2 ? 'borrowed' : ''}">${row.map((v) => `<span>${esc(v)}</span>`).join('')}</div>`,
        )
        .join(
          '',
        )}</div><div class="scrutiny"><section><span>APPEARANCE</span><strong>FAMILIAR</strong></section><section><span>INTENT</span><strong>UNVERIFIED</strong></section><section><span>ALARM</span><strong>${s.security.alarm ? 'HEIGHTENED' : 'NORMAL'}</strong></section></div><p class="artifact-note">Uniform → evasion. ${s.security.alarm ? 'The alarm cancels the disguise advantage.' : 'Guards can still recognize the player up close.'}</p>`,
      'process-scene',
    );
  else
    focus = panel(
      'INTERNAL / TRUST RELATIONSHIPS',
      'LIVE POSITION + INVENTORY',
      `${topology(s, t)}<div class="network-caption"><b>${esc(t.services[2])}</b><span>${s.player?.card ? 'The credential opens the protected resource.' : 'The protected resource still requires the manager’s identity.'}</span></div><div class="lateral-evidence">${tag(s.player?.card ? 'IDENTITY ACQUIRED' : 'IDENTITY REQUIRED', s.player?.card ? 'green' : '')}${tag(s.player?.disguised ? 'DISGUISE ACTIVE' : 'STANDARD SCRUTINY', s.player?.disguised ? 'violet' : '')}${tag(s.security.camerasDown ? 'MONITORING DISABLED' : 'MONITORING ACTIVE', s.security.camerasDown ? 'red' : 'cyan')}</div>`,
      'network-scene',
    );
  const checklist = [
    ['lateral.power', 'Interrupt monitoring', 'Fuse box'],
    ['lateral.uniform', 'Blend into trusted activity', 'Staff uniform'],
    ['lateral.card', 'Acquire resource permissions', 'Manager’s card'],
    ['lateral.vault', 'Reach the sensitive archive', 'Vault'],
  ];
  return `<div class="lateral-grid">${focus}<div class="lateral-sidebar">${panel('OPERATION / OBJECTIVES', 'FROM THE MISSION BOARD', `<div class="objective-list">${checklist.map(([id, label, metaphor], i) => `<div class="${done(s, id) ? 'done' : ''}"><b>${done(s, id) ? '✓' : `0${i + 1}`}</b><span><strong>${label}</strong><small>${metaphor}</small></span><i>${done(s, id) ? 'CONFIRMED' : 'OPEN'}</i></div>`).join('')}</div>`)}${panel('DEFENSE / POSTURE', 'LIVE', `<div class="posture">${stat('MONITORING', s.security.camerasDown ? 'SILENT' : 'ACTIVE', s.security.camerasDown ? 'danger' : '')}${stat('GUARDS IN PURSUIT', s.security.guards.filter((g) => g.state === 'chase').length)}${stat('ALARM', s.security.alarm ? 'RAISED' : 'QUIET', s.security.alarm ? 'danger' : '')}</div>`)}<div class="lesson-note">${tr(s, 'Being inside a network does not grant every permission. The next move is about trust.', 'כניסה לרשת אינה מעניקה את כל ההרשאות. הצעד הבא עוסק באמון.')}</div></div></div>`;
}

function exfil(s: Snapshot, t: Target): string {
  const n = s.exfil.needed || 3;
  const loads = s.exfil.loads;
  const drilling = s.interaction?.kind === 'drill';
  return `<div class="exfil-grid">${panel('SOURCE / SENSITIVE ARCHIVE', t.services[2].toUpperCase(), `<div class="archive-title"><span>DATA IN SCOPE</span><h2>${esc(t.short)}<br>PRIVATE ARCHIVE</h2></div><div class="archive-files">${t.datasets.map((name, i) => `<div class="archive-file ${loads > i ? 'sent' : s.player?.carrying && loads === i ? 'carried' : ''}"><span class="file-type">${name.split('.').pop()?.slice(0, 4).toUpperCase()}</span><div><strong>${name}</strong><small>${loads > i ? 'DELIVERED' : s.player?.carrying && loads === i ? 'IN TRANSIT' : 'AT SOURCE'}</small></div><b>${loads > i ? '✓' : s.player?.carrying && loads === i ? '↗' : '▥'}</b></div>`).join('')}</div><div class="archive-note">${tr(s, 'Each archive represents one load of money in the game.', 'כל ארכיון מייצג חבילת כסף אחת במשחק.')}</div>`, 'archive-panel')}<div class="channel-stack">${panel('BOUNDARY / OUTBOUND CHANNEL', s.exfil.hole ? 'CHANNEL OPEN' : 'ESTABLISHING CHANNEL', `<div class="channel-state">${tag(s.exfil.hole ? 'OPEN' : drilling ? 'NEGOTIATING' : 'CLOSED', s.exfil.hole ? 'green' : 'amber')}<strong>${s.exfil.hole ? 'The boundary is open.' : drilling ? 'Control the noise.' : 'Build a way out.'}</strong></div>${waveform(s, 'drill')}<div class="scope-stats">${stat('CHANNEL', `${percent(s.exfil.channelProgress)}%`)}${stat('NOISE', drilling ? `${percent(s.interaction!.heat)}%` : '—', s.interaction?.jammed ? 'danger' : '')}${stat('STATE', s.interaction?.jammed ? 'JAMMED' : s.exfil.hole ? 'OPEN' : drilling ? (s.interaction!.heat > 0 ? 'ACTIVE' : 'IDLE') : 'WAITING')}</div>${bar(s.exfil.channelProgress)}<p class="artifact-note">${tr(s, 'Holding the drill drives the scope. Overheating creates a detectable burst.', 'לחיצה על המקדחה מניעה את הגרף. התחממות יתר יוצרת פרץ שניתן לזיהוי.')}</p>`, 'scope-panel')}${panel('DESTINATION / RECEIVING SERVER', s.exfil.van ? 'SERVER READY' : s.exfil.hole ? 'PROVISIONING' : 'OFFLINE', `<div class="receiver"><div class="receiver-name"><span class="server-icon">▤</span><div><b>relay-${esc(s.operator.toLowerCase())}.example</b><span>${s.exfil.van ? 'READY TO RECEIVE' : s.exfil.hole ? 'WAITING FOR THE VAN TO ARRIVE' : 'WAITING FOR AN OUTBOUND CHANNEL'}</span></div></div><div class="packet-pipe ${s.player?.carrying && s.exfil.van ? 'flowing' : ''}"><span>SOURCE</span><i></i><i></i><i></i><span>RECEIVER</span></div><div class="delivery-count"><strong>${String(loads).padStart(2, '0')}<small> / ${String(n).padStart(2, '0')}</small></strong><span>${tr(s, 'LOADS DELIVERED', 'חבילות שנמסרו')}</span>${s.exfil.complete ? tag('EXTRACTION COMPLETE', 'green') : tag(s.player?.carrying ? 'CARRYING A LOAD' : 'WAITING FOR A LOAD', 'amber')}</div>${bar(loads / n)}</div>`, 'receiver-panel')}</div></div>`;
}

function eventText(item: JournalEvent, t: Target): string {
  const e = item.event;
  switch (e.kind) {
    case 'spotted':
      return `Detection raised by ${e.guard}`;
    case 'caught':
      return `Agent ${e.thief} contained by ${e.guard}`;
    case 'alarm':
      return e.source === 'chief'
        ? 'Operator escalated detection'
        : 'Monitoring triggered an alert';
    case 'powerCut':
      return 'Security monitoring interrupted';
    case 'disguised':
      return 'Agent adopted a trusted appearance';
    case 'pickup':
      return e.key.includes('uniform')
        ? 'Trusted appearance acquired'
        : e.key.includes('fuse')
          ? 'Monitoring access acquired'
          : `Resource identity acquired / ${t.account}`;
    case 'guardOrdered':
      return `Response unit reassigned / ${e.guard}`;
    case 'breach':
      return `Agent ${e.thief} reached the protected archive`;
    case 'doorLocked':
      return `${e.locked ? 'Access restricted' : 'Access restored'} / ${e.door}`;
    case 'lockpickStart':
      return 'Legacy access boundary under test';
    case 'lockpickEnd':
      return 'Service access boundary crossed';
    case 'wireStart':
      return 'Telemetry interruption started';
    case 'wireCut':
      return `Monitoring circuit interrupted / ${e.left} remaining`;
    case 'wireShort':
      return 'Interruption attempt generated noise';
    case 'truckBoard':
      return 'Agent joined a trusted vendor delivery';
    case 'truckLeave':
      return e.inside
        ? 'Vendor trust crossed the perimeter'
        : 'Agent left the vendor delivery';
    case 'portalEnter':
      return `${e.portal === 'p_vent' ? 'Gateway' : 'Undocumented surface'} traversal started`;
    case 'portalExit':
      return 'Alternate service reached';
    case 'badged':
      return 'Valid credential accepted at the access boundary';
    case 'drillStart':
      return 'Outbound channel setup started';
    case 'drillJam':
      return 'Channel setup burst exceeded the noise threshold';
    case 'holeOpen':
      return 'Outbound channel established';
    case 'vanArrived':
      return 'Receiving server became available';
    case 'loadTaken':
      return `Agent ${e.thief} staged an archive for transfer`;
    case 'loadDelivered':
      return `Archive delivered / load ${e.out}`;
    case 'exfilDone':
      return 'Human extraction completed';
    case 'thiefDone':
      return `Agent ${e.thief} / ${e.reason}`;
    case 'respawn':
      return 'Operator reset to the external perimeter';
    case 'printStart':
      return 'Archive staging started';
    default:
      return '';
  }
}
function eventFeed(s: Snapshot, t: Target, limit = 6): string {
  const events = s.events
    .filter((e) => e.stage === s.state && eventText(e, t))
    .slice(-limit)
    .reverse();
  return `<div class="event-feed">${events.length ? events.map((e) => `<div data-key="event-${e.id}" class="${['caught', 'alarm', 'drillJam'].includes(e.event.kind) ? 'alert' : ''}"><time>${clock(e.tick * 50)}</time><span>${esc(eventText(e, t))}</span></div>`).join('') : `<div class="empty-feed">${tr(s, 'Watching the game for the next event.', 'ממתינים לאירוע הבא במשחק.')}</div>`}</div>`;
}

/** Idle packets keep the connection alive without rebuilding the waiting screen. */
export function frameKey(s: DisplaySnapshot): string {
  return s.state === 'round1' ? `${s.run}:${s.seq}` : `standby:${s.language}`;
}

export function renderSnapshot(s: DisplaySnapshot): string {
  if (s.state !== 'round1')
    return `<section class="waiting" data-scene="standby" data-key="standby" dir="${s.language === 'he' ? 'rtl' : 'ltr'}"><span class="eyebrow">${tr(s, 'PHASE 1 / THE VISITOR IS THE THIEF', 'שלב 1 / המבקר הוא הגנב')}</span><h1>${tr(s, 'Waiting for the thief round.', 'ממתינים לסבב הגנב.')}</h1><p>${tr(s, 'This screen follows the visitor’s heist: reconnaissance, initial access, lateral movement, and data exfiltration.', 'המסך הזה עוקב אחר השוד של המבקר: איסוף מידע, גישה ראשונית, תנועה רוחבית והוצאת מידע.')}</p><p class="muted">${tr(s, 'It starts automatically when the visitor becomes the thief. Continue on the main game screen.', 'המסך יתחיל אוטומטית כשהמבקר יהפוך לגנב. המשיכו במסך המשחק הראשי.')}</p></section>`;
  const target = targetAt(s.target),
    id = sceneId(s),
    c = copy(s, id);
  const alert = recent(s, ['caught', 'alarm', 'drillJam', 'wireShort'], 60);
  const content =
    id === 'recon'
      ? recon(s, target)
      : id.startsWith('access-')
        ? access(s, target, id)
        : id.startsWith('lateral')
          ? lateral(s, target, id)
          : exfil(s, target);
  return `<div class="operation" data-scene="${id}" data-key="${id}" style="--target-color:${target.color}"><div class="operation-top"><div class="target-lockup"><span class="target-mark">${esc(target.short.slice(0, 2))}</span><div><b>${esc(target.name)}</b><span>${esc(target.sector)} / ${esc(target.domain)}</span></div></div><div class="operation-meta"><span>${esc(s.operator.toUpperCase())}</span><b>${clock(s.stageMs)}</b><span>RED TEAM</span></div></div>${phaseRail(s)}<div class="scene-intro" dir="${s.language === 'he' ? 'rtl' : 'ltr'}"><span class="eyebrow">${c.chapter}</span><h1>${esc(c.title)}</h1><p>${esc(c.subtitle)}</p></div><div class="scene-content">${content}</div><div class="translation-strip" dir="${s.language === 'he' ? 'rtl' : 'ltr'}"><span>${tr(s, 'IN THE GAME → IN THE NETWORK', 'במשחק ← ברשת')}</span><p>${esc(c.link)}</p></div>${alert ? `<div class="live-alert" role="status"><b>${tr(s, 'LIVE EVENT', 'אירוע חי')}</b>${esc(eventText(alert, target))}</div>` : ''}</div>`;
}
