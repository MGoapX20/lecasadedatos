import { agentUnresolved } from './defense';
import { esc } from './html';
import type { AgentStatus, DefenseLog, DefenseSnapshot, EntryId } from './protocol';
import { targetAt } from './targets';

const entries: [EntryId, string, string][] = [
  ['front', 'Front doors / Identity', 'דלת ראשית / זהות'],
  ['side', 'Side door / Legacy API', 'דלת צד / API ישן'],
  ['dock', 'Supplier / Partner access', 'ספק / גישת שותפים'],
  ['vent', 'Roof / Unpatched service', 'גג / שירות לא מעודכן'],
  ['sewer', 'Sewer / Unknown flaw', 'ביוב / פרצה לא מוכרת'],
];
const statusLabels: Record<AgentStatus, [string, string]> = {
  queued: ['QUEUED', 'בתור'], approach: ['APPROACHING', 'מתקרב'], inside: ['INSIDE', 'בפנים'],
  waiting: ['WAITING', 'ממתין'], transit: ['IN TRANSIT', 'במעבר'], picking: ['PICKING LOCK', 'פורץ מנעול'],
  truckWaiting: ['WAITING FOR TRUCK', 'ממתין למשאית'], truckRiding: ['STOWED IN TRUCK', 'מסתתר במשאית'],
  blocked: ['DOOR BLOCKED', 'נעצר בדלת'], caught: ['CAUGHT', 'נתפס'], held: ['HELD', 'נבלם'],
  expired: ['TIMED OUT', 'תם הזמן'], breached: ['BREACHED', 'פרץ לכספת'], extracting: ['EXFILTRATING', 'מוציא מידע'], extracted: ['DATA OUT', 'המידע יצא'],
};
const messages: Record<string, [string, string]> = {
  'agent.queued': ['Attack session queued', 'תקיפה נכנסה לתור'],
  'agent.approach': ['Agent moving toward entry', 'תוקף מתקדם לכניסה'],
  'agent.inside': ['Intruder crossed the perimeter', 'תוקף חצה את ההיקף'],
  'agent.waiting': ['Agent holding position', 'תוקף ממתין במקום'],
  'agent.truckWaiting': ['Agent waiting for supplier pickup', 'תוקף ממתין לאיסוף הספק'],
  'truck.board': ['Stowaway boarded the supplier truck', 'נוסע סמוי עלה למשאית הספק'],
  'truck.inside': ['Stowaway entered through the loading bay', 'נוסע סמוי נכנס דרך רציף הפריקה'],
  'truck.leave': ['Stowaway left the supplier truck', 'נוסע סמוי ירד ממשאית הספק'],
  'agent.blocked': ['Locked door blocking agent', 'דלת נעולה עוצרת תוקף'],
  'agent.caught': ['Guard caught the intruder', 'שומר תפס את התוקף'],
  'agent.held': ['Route stopped by a locked door', 'המסלול נבלם בדלת נעולה'],
  'agent.expired': ['Attack session expired', 'פג זמן התקיפה'],
  'guard.ordered': ['Guard dispatched to new position', 'שומר נשלח לעמדה חדשה'],
  'guard.spotted': ['Guard detected an intruder', 'שומר זיהה תוקף'],
  'alarm.camera': ['Camera detection — alarm raised', 'זיהוי מצלמה — אזעקה הופעלה'],
  'alarm.chief': ['Chief activated the alarm', 'מפקד הפעיל אזעקה'],
  'door.locked': ['Door locked by chief', 'המפקד נעל דלת'],
  'door.unlocked': ['Door unlocked by chief', 'המפקד פתח מנעול'],
  'access.pick': ['Lock bypass in progress', 'פריצת מנעול בתהליך'],
  'access.open': ['Lock picked — access gained', 'המנעול נפרץ — הושגה גישה'],
  'access.badged': ['Door opened with stolen credentials', 'דלת נפתחה בהרשאות גנובות'],
  'identity.card': ['Manager credentials acquired', 'הרשאות המנהל נגנבו'],
  'identity.uniform': ['Agent using a staff identity', 'תוקף משתמש בזהות עובד'],
  'monitor.offline': ['Camera monitoring disabled', 'ניטור המצלמות הושבת'],
  'monitor.online': ['Camera monitoring restored', 'ניטור המצלמות חזר'],
  'transit.start': ['Agent entered an access passage', 'תוקף נכנס למעבר גישה'],
  'transit.end': ['Agent emerged from access passage', 'תוקף יצא ממעבר גישה'],
  'data.breach': ['VAULT BREACHED — protected data reached', 'הכספת נפרצה — הושגה גישה למידע'],
  'data.staged': ['Data collected for exfiltration', 'מידע נאסף להוצאה'],
  'data.delivered': ['DATA LEFT THE BUILDING', 'המידע יצא מהבניין'],
  'boundary.open': ['Extraction route opened in wall', 'נפתח בקיר נתיב להוצאת מידע'],
  'noise': ['Unusual noise detected', 'זוהה רעש חריג'],
  'routes.replanned': ['AI adapted routes to the defenses', 'הבינה התאימה מסלולים להגנות'],
  'plans.ready': ['Parallel attack plans ready', 'תוכניות התקיפה המקבילות מוכנות'],
};
const time = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const toneFor = (status: AgentStatus): string => ['breached', 'extracting', 'extracted'].includes(status) ? 'critical'
  : ['caught', 'held'].includes(status) ? 'success' : ['inside', 'picking', 'transit', 'truckRiding', 'blocked'].includes(status) ? 'warning' : 'info';

export function renderDefense(s: DefenseSnapshot): string {
  const d = s.defense, t = targetAt(s.target), he = s.language === 'he';
  const tr = (en: string, il: string) => he ? il : en;
  const msg = (e: DefenseLog) => (messages[e.code] ?? [e.code, e.code])[he ? 1 : 0];
  const swarm = s.state === 'round2b', planning = s.state === 'aiThink', ready = s.state === 'brief2';
  const mode = swarm ? 'swarm' : planning ? 'planning' : ready ? 'ready' : 'single';
  const tone = d.breached || d.camerasDown ? 'critical' : d.inside || d.alarm || d.active > 4 ? 'warning' : 'calm';
  const stopped = !!d.ended || s.paused || !!s.suspended;
  const endedText = d.ended === 'caught' ? tr('INTRUDER CAUGHT', 'התוקף נתפס')
    : d.ended === 'held' ? tr('ATTACK STOPPED', 'התקיפה נבלמה')
    : d.ended === 'breached' ? tr('VAULT BREACHED', 'הכספת נפרצה')
    : d.ended === 'timeout' ? tr('TIME IS UP', 'הזמן נגמר') : tr('SWARM ENDED', 'הנחיל הסתיים');
  const headline = d.ended ? endedText : ready ? tr('YOU HAVE CONTROL', 'השליטה בידיים שלכם')
    : planning ? tr('PARALLEL ATTACK IN PREPARATION', 'תקיפה מקבילית בהכנה')
    : d.breached ? tr('PROTECTED DATA COMPROMISED', 'המידע המוגן נפרץ')
    : d.inside ? d.inside === 1 ? tr('INTRUDER INSIDE THE BUILDING', 'תוקף בתוך הבניין') : tr('INTRUDERS INSIDE THE BUILDING', 'תוקפים בתוך הבניין')
    : swarm && d.active > 1 ? tr('MULTIPLE ATTACKS IN PROGRESS', 'מספר תקיפות במקביל')
    : d.active ? tr('TRACKING ONE INTRUDER', 'עוקבים אחרי תוקף אחד')
    : tr('MONITORING THE PERIMETER', 'מנטרים את ההיקף');
  const subtitle = d.ended ? `${d.caught + d.held} ${tr('stopped', 'נבלמו')} / ${d.breached} ${tr('breached', 'פרצו')} / ${d.active + d.queued} ${tr('unfinished', 'לא סיימו')}`
    : ready ? tr('Move guards. Lock doors. Watch the entries.', 'הזיזו שומרים. נעלו דלתות. עקבו אחרי הכניסות.')
    : planning ? d.planningReady ? `${d.plannedAgents} ${tr('agents ready to launch', 'תוקפים מוכנים לצאת')}` : tr('The AI is planning against your defenses.', 'הבינה מתכננת מול ההגנות שלכם.')
    : `${d.active} ${tr('active', 'פעילים')} · ${d.queued} ${tr('queued', 'בתור')} · ${d.inside} ${tr('inside', 'בפנים')}`;
  const metric = (label: string, value: string | number, kind = '') => `<div class="siem-metric ${kind}"><span>${label}</span><strong>${value}</strong></div>`;
  const paths = entries.map(([entry, en, il], i) => {
    const actors = d.agents.filter(a => a.entry === entry), active = actors.filter(agentUnresolved).length;
    const breaches = actors.filter(a => ['breached', 'extracting', 'extracted'].includes(a.status)).length;
    const caught = actors.filter(a => ['caught', 'held'].includes(a.status)).length;
    const state = breaches ? 'critical' : active ? 'warning' : caught ? 'success' : 'info';
    const endpoint = t.endpoints.find(e => e.entry === entry && (entry !== 'front' || e.kind === 'identity')) ?? t.endpoints.find(e => e.entry === entry);
    return `<div class="siem-path" data-level="${state}" data-active="${!!active && !stopped}"><span class="siem-path-index">0${i + 1}</span><div class="siem-path-name"><b>${tr(en, il)}</b><code dir="ltr">${esc(endpoint?.path ?? entry)}</code></div><div class="siem-path-traffic" aria-hidden="true">${actors.map(a => `<i data-key="path-${a.id}" data-level="${toneFor(a.status)}" title="${esc(a.name)}"></i>`).join('')}</div><div class="siem-path-count"><b>${active}</b><small>${tr('active', 'פעילים')}</small></div><div class="siem-path-result ${breaches ? 'critical' : ''}"><b>${breaches}</b><small>${tr('breached', 'פרצו')}</small></div></div>`;
  }).join('');
  const sessions = d.agents.map(a => `<div class="siem-agent" data-key="agent-${a.id}" data-level="${toneFor(a.status)}" data-status="${a.status}" title="${esc(`${a.name} · ${a.entry} · ${statusLabels[a.status][he ? 1 : 0]}`)}"><span class="siem-agent-id" dir="ltr">A${String(a.id).padStart(2, '0')}</span><b>${statusLabels[a.status][he ? 1 : 0]}</b>${!swarm ? `<small>${esc(a.name)} · ${esc(a.entry)}</small>` : ''}</div>`).join('');
  const eventRow = (e: DefenseLog) => `<div class="siem-log" data-key="log-${e.id}" data-level="${e.level}"><time>${time(e.atMs)}</time><span class="siem-log-dot" aria-hidden="true"></span><div><b>${esc(msg(e))}</b><small dir="ltr">${e.actor === undefined ? '' : `A${String(e.actor).padStart(2, '0')} / `}${esc(e.source)}${e.entry ? ` / ${esc(e.entry)}` : ''}</small></div></div>`;
  const alerts = stopped ? [] : d.logs.filter(e => e.level !== 'info' && d.nowMs - e.atMs >= 0 && d.nowMs - e.atMs < 4200).slice(-(swarm ? 4 : 1)).reverse();
  const peak = Math.max(1, ...d.history);
  const columns = Math.max(1, Math.ceil(Math.sqrt(d.agents.length * 3.5)));
  const rows = Math.max(1, Math.ceil(d.agents.length / columns));
  return `<section class="siem" data-scene="defense-${mode}" data-key="siem-${esc(s.run)}-${esc(d.epoch)}" data-mode="${mode}" data-tone="${tone}" data-ended="${!!d.ended}" dir="${he ? 'rtl' : 'ltr'}">
    <header class="siem-head"><div class="siem-title"><svg viewBox="0 0 32 36" aria-hidden="true"><path d="M16 2 29 7v10c0 8-7 14-13 17C10 31 3 25 3 17V7Z"/><path d="m10 18 4 4 8-10"/></svg><div><span>${tr('SECURITY OPERATIONS', 'מרכז בקרת אבטחה')}</span><h1>${esc(t.name)}</h1><small dir="ltr">${esc(t.domain)} / SIEM</small></div></div><div class="siem-mode"><i></i>${swarm ? tr('PARALLEL SWARM', 'נחיל מקבילי') : planning ? tr('NEXT WAVE', 'הגל הבא') : ready ? tr('DEFENSE READY', 'ההגנה מוכנה') : tr('SINGLE AGENT', 'תוקף יחיד')}</div><div class="siem-clock"><span>${tr('TIME LEFT', 'זמן שנותר')}</span><b>${d.capMs ? time(Math.max(0, d.capMs - s.stageMs)) : '—'}</b></div></header>
    <div class="siem-status"><span class="siem-status-light"></span><div><h2>${headline}</h2><p>${subtitle}</p></div><span class="siem-alarm ${d.alarm ? 'on' : ''}">${d.alarm ? tr('ALARM ACTIVE', 'אזעקה פעילה') : tr('ALARM IDLE', 'אזעקה שקטה')}</span></div>
    <div class="siem-metrics">${metric(tr('ACTIVE INTRUDERS', 'תוקפים פעילים'), d.active)}${metric(tr('INSIDE', 'בפנים'), d.inside, d.inside ? 'warning' : '')}${metric(tr('STOPPED', 'נבלמו'), d.caught + d.held, 'success')}${metric(tr('VAULT BREACHES', 'פריצות לכספת'), d.breached, d.breached ? 'critical' : '')}${metric(tr('EVENTS / SEC', 'אירועים / שנ׳'), d.eventsPerSecond.toFixed(1))}</div>
    <div class="siem-body"><div class="siem-network"><section class="siem-panel siem-ingress"><div class="siem-panel-heading"><h3>${tr('ENTRY POINTS', 'נקודות כניסה')}</h3><span>${tr('5 MONITORED ROUTES', '5 מסלולים בניטור')}</span></div><div class="siem-paths">${paths}</div></section><section class="siem-panel siem-sessions"><div class="siem-panel-heading"><h3>${tr('ATTACK SESSIONS', 'תהליכי תקיפה')}</h3><span>${d.agents.length} ${d.agents.length === 1 ? tr('AGENT', 'תוקף') : tr('AGENTS', 'תוקפים')}</span></div><div class="siem-agent-grid" style="--agent-cols:${columns};--agent-rows:${rows}">${sessions || `<div class="siem-quiet"><span>◈</span>${planning ? tr('Awaiting swarm deployment', 'ממתינים לשיגור הנחיל') : tr('No active intruders', 'אין תוקפים פעילים')}</div>`}</div></section><section class="siem-controls"><div class="siem-sensor ${d.camerasDown ? 'critical' : 'success'}"><i></i><b>${tr('CAMERAS', 'מצלמות')}</b><span>${d.camerasDown ? tr('OFFLINE', 'כבויות') : tr('ONLINE', 'פעילות')}</span></div><div class="siem-sensor"><b>${tr('LOCKS LEFT', 'נעילות שנותרו')}</b><strong>${d.locksLeft}</strong></div><div class="siem-guards">${d.guards.map(g => `<span class="siem-guard ${g.state === 'chase' ? 'warning' : ''}" title="${esc(g.id)}"><i></i><b>${esc(g.id)}</b><small>${!g.present ? tr('AWAY', 'נעדר') : g.state === 'chase' ? tr('PURSUING', 'במרדף') : g.state === 'suspicious' ? tr('CHECKING', 'בודק') : g.state === 'return' ? tr('RETURNING', 'חוזר') : tr('ON DUTY', 'בתפקיד')}</small></span>`).join('')}</div><div class="siem-door-strip">${d.doors.map(door => `<span data-key="door-${esc(door.id)}" class="${door.bypassed ? 'critical' : door.locked ? 'success' : ''}" title="${esc(door.id)}">${esc(door.id.replace(/^d_/, ''))}<b>${door.bypassed ? tr('PICKED', 'נפרץ') : door.locked ? tr('LOCKED', 'נעול') : tr('OPEN', 'פתוח')}</b></span>`).join('')}</div></section></div>
    <section class="siem-panel siem-stream"><div class="siem-panel-heading"><h3>${tr('LIVE EVENT STREAM', 'זרם אירועים חי')}</h3><span>${d.totalEvents} ${tr('EVENTS', 'אירועים')}</span></div><div class="siem-stream-graph"><svg viewBox="0 0 300 32" preserveAspectRatio="none" role="img" aria-label="${tr('Actual events in the last 30 simulation seconds', 'אירועים בפועל ב־30 שניות הסימולציה האחרונות')}">${d.history.map((n, i) => `<rect x="${i * 10}" y="${32 - n / peak * 30}" width="7" height="${Math.max(1, n / peak * 30)}"/>`).join('')}</svg><span>30s</span></div><div class="siem-log-list">${[...d.logs].reverse().slice(0, 80).map(eventRow).join('') || `<div class="siem-quiet"><span>⌁</span>${tr('Listening for game events', 'ממתינים לאירועים במשחק')}</div>`}</div><aside class="siem-alerts" aria-label="${tr('Recent alerts', 'התראות אחרונות')}">${alerts.map(e => `<div class="siem-alert" data-key="alert-${e.id}" data-level="${e.level}"><span>${e.level === 'success' ? '✓' : '!'}</span><div><b>${esc(msg(e))}</b><small dir="ltr">${e.actor === undefined ? '' : `AGENT ${e.actor} / `}${esc(e.source)}</small></div></div>`).join('')}</aside></section></div>
    <footer class="siem-footer"><span>${tr('GAME TELEMETRY', 'נתוני המשחק')} / ${esc(s.operator)}</span><span>${d.ended ? tr('WAVE CLOSED', 'הגל הסתיים') : tr('GUARDS = ENDPOINT DEFENSE · CAMERAS = MONITORING', 'שומרים = הגנת קצה · מצלמות = ניטור')}</span></footer>
  </section>`;
}
