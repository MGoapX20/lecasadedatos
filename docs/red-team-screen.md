# Red-team / defense companion screen

The second screen translates the thief round into a fictional cyber operation, then switches automatically to **Defense Live**, a security control room, from the defense briefing through the swarm. Idle stages show a static waiting screen. It resumes automatically for the next visitor. It is a spectator display; the game is the authority for every phase, success, failure, and counter. Both pages run from the same local server and browser profile, including without internet access.

## Visual plan

| Game moment          | Cyber representation                                                                                                                                            | Live source                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Recon                | A public company website and endpoint discovery console. Companies use different layouts: orbital freight, research, culture, energy, finance, and architecture | Mission phase, discovered entrances, simulation clock                            |
| Front door           | A convincing inbox message alongside an identity-provider sign-in handoff                                                                                       | Closest discovered entrance / actual entry                                       |
| Side door            | A deployed-versus-patched version comparison                                                                                                        | Lockpicking pins and misses                                                      |
| Supplier truck       | A vendor artifact moving through a trusted deployment pipeline                                                                                                  | Truck boarding and unloading                                                     |
| Roof vent            | An exposed gateway with an overdue maintenance queue                                                                                                            | Vent traversal                                                                   |
| Sewer                | An undocumented API contract and anomalous response trace                                                                                                       | Sewer traversal                                                                  |
| Lateral movement     | Internal service topology; an identity permission manifest for the card; process disguise for the uniform; an interrupted telemetry waveform for the fuse       | Actual inventory, mini-games, guard state, security events                       |
| Vault / exfiltration | A data archive, outbound-channel oscilloscope, and receiving server                                                                                             | Drill progress/heat/jams, wall opening, van arrival, carried and delivered loads |

The fictional organization's identity is stable for one visit; it changes without repeating until all six organizations have been used. Each entrance has a different medium. Lateral movement changes its main scene when the player works the fuse, acquires a card, or uses a disguise. A small simulation label identifies the fictional surfaces; it never invents gameplay success or real measurements.

The board fills the available viewport with the current activity. Recon gives the website and endpoints two large panels; access and lateral movement use one focused surface; exfiltration shows the archive, channel, and receiver. A compact header holds the target, current phase, and elapsed time. Narrow screens stack the panels; unusually small panels can scroll locally without shrinking the whole board. Repeated lessons, checklists, captions, and the footer are removed.

## Defense control room

`brief2` shows the ready security room; `round2a` tracks the single attacker.
`aiThink` shows planning status and the actual ready plan count, with no active
intruders claimed. `round2b` shows all spawned sessions in a compact matrix, five
entry channels mapped to the same fictional organization's endpoints, a rolling
incident stream, recent alert cards, and guard/door/camera status.

Counts come from actual plan-following thieves. Queued agents are separate from
active intruders. Caught, door-held, timed-out, breached, and exfiltrating sessions
remain distinguishable. Vault access and data leaving the building produce
separate incidents. Severity increases with inside intruders, alarms, disabled
cameras, and breaches. A successful single-agent defense shows its real verdict;
a single agent who breaches gets a breach warning too.

`DefenseProjector` records simulation events and observed state changes (arrival,
inside crossing, waiting, blocked, power, replanning). There are no randomized
traffic counters or invented attacks. The event rate averages five one-second
simulation buckets; the graph shows thirty buckets. This is game telemetry,
including the attackers' state, rather than a claim that powered-off cameras
still detect them. The journal retains 160 rows, displays the latest 80, and keeps
an accurate total. Recent alerts hold for 4.2 simulation seconds, with one card in
the lone-agent phase and up to four during the swarm. New keyed rows animate once.

A pause, hidden game, disconnected feed, or wave ending stops animations. An ended
wave clears alert cards and freezes its result until the normal stage transition.
Stage revisions and visits reset the journal, including resetting the same wave.
English/Hebrew, narrow layouts, and reduced motion are supported.

## Synchronization

- During the thief and defense stages, the main page publishes a versioned snapshot at five updates per second. Idle states send only a small connection heartbeat once per second, without reading the world, missions, agents, or planner. Phase changes bypass throttling. The receiver does not rebuild its waiting screen for idle heartbeats. The thief and defense projections keep separate bounded journals, so late subscribers receive context without replaying old alerts.
- A per-game BroadcastChannel isolates simultaneous sessions. The companion URL carries the pairing ID. A discovery channel lets an unpaired display find open games; it asks the viewer to choose if more than one is available.
- A hello handshake gets the latest snapshot immediately. The display survives refresh, detects stale heartbeats, freezes when paused or disconnected, and resets on a new visit.
- The transport is read-only. The companion cannot move a player, change a door, or advance a round. Its failure cannot prevent the game from starting.
- Open from the attract screen, the pause menu, or F2. Move the tab to another monitor and use its fullscreen button. Both pages must use the same browser profile and local-server address.

## Validation

Check projections against real SimWorld/MissionTracker fixtures, run the existing simulation tests, verify pairing/reconnect/sequence handling, and include both HTML entrypoints in the production build. No external sites, credentials, endpoints, scripts, or fonts are contacted by the companion.
