# Red-team companion screen

The second screen translates **only phase 1, when the visitor is the thief**, into a fictional cyber operation. It runs through recon, initial access, lateral movement, and exfiltration. Before and after the thief round, it shows a static waiting screen; it resumes automatically for the next visitor. It is a spectator display; the game is the authority for every phase, success, failure, and counter. Both pages run from the same local server and browser profile, including without internet access.

## Visual plan

| Game moment          | Cyber representation                                                                                                                                            | Live source                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Recon                | A public company website and endpoint discovery console. Companies use different layouts: orbital freight, research, culture, energy, finance, and architecture | Mission phase, discovered entrances, simulation clock                            |
| Front door           | A convincing inbox message alongside an identity-provider sign-in handoff                                                                                       | Closest discovered entrance / actual entry                                       |
| Side door            | A legacy-service release history and patch-gap inspector                                                                                                        | Lockpicking pins and misses                                                      |
| Supplier truck       | A vendor artifact moving through a trusted deployment pipeline                                                                                                  | Truck boarding and unloading                                                     |
| Roof vent            | An exposed gateway with an overdue maintenance queue                                                                                                            | Vent traversal                                                                   |
| Sewer                | An undocumented API contract and anomalous response trace                                                                                                       | Sewer traversal                                                                  |
| Lateral movement     | Internal service topology; an identity permission manifest for the card; process disguise for the uniform; an interrupted telemetry waveform for the fuse       | Actual inventory, mini-games, guard state, security events                       |
| Vault / exfiltration | A data archive, outbound-channel oscilloscope, and receiving server                                                                                             | Drill progress/heat/jams, wall opening, van arrival, carried and delivered loads |

The fictional organization's identity is stable for one visit; it changes without repeating until all six organizations have been used. Each entrance has a different medium. Lateral movement changes its main scene when the player works the fuse, acquires a card, or uses a disguise. Decorative endpoint traffic is labeled simulated; it never invents gameplay success or real measurements.

## Synchronization

- During the thief round, the main page publishes a compact, versioned snapshot at five updates per second. Outside it, only a small connection heartbeat is sent once per second, without reading the world, missions, agents, or planner. Phase changes bypass throttling. The receiver does not rebuild its waiting screen for these heartbeats. Only thief-round simulation events are recorded in a bounded sequence-numbered journal, so late subscribers receive context without replaying old alerts.
- A per-game BroadcastChannel isolates simultaneous sessions. The companion URL carries the pairing ID. A discovery channel lets an unpaired display find open games; it asks the viewer to choose if more than one is available.
- A hello handshake gets the latest snapshot immediately. The display survives refresh, detects stale heartbeats, freezes when paused or disconnected, and resets on a new visit.
- The transport is read-only. The companion cannot move a player, change a door, or advance a round. Its failure cannot prevent the game from starting.
- Open from the attract screen, the pause menu, or F2. Move the tab to another monitor and use its fullscreen button. Both pages must use the same browser profile and local-server address.

## Validation

Check projections against real SimWorld/MissionTracker fixtures, run the existing simulation tests, verify pairing/reconnect/sequence handling, and include both HTML entrypoints in the production build. No external sites, credentials, endpoints, scripts, or fonts are contacted by the companion.
