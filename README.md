# La Casa de Uranio — The AI Heist

A 3D browser game built as a fair station. A visitor infiltrates a nuclear base, then
defends the base against an AI. The point of the station is the gap between
those two experiences.

## The visit, in about three and a half minutes

1. **Attract loop.** The Mint at night, with a real AI swarm streaming through it.
2. **Round 1 — you are the attacker.** Get inside, reach the vault, and extract TOP SECRET documents.
3. **Round 2a — you are the chief of security.** One human-paced thief comes. You
   usually catch him.
4. **Round 2b — the AI comes.** Dozens of agents, all with different plans, at once.
5. **Results.** "You found 1 way in, in 41 seconds. The AI found 12, in 0.2 seconds."
   Then every part of the bank is translated into something from the visitor's own life.

## The AI is real

There is no scripted footage and no language model. The bank is a data file, and
the attacker is a planner that genuinely searches it:

- Guard patrols and camera sweeps are baked into a **danger map** over time.
- Routes are found with **Safe Interval Path Planning** over `(cell, safe window)`,
  so "wait for the patrol to pass" is a normal move rather than a special case.
- The high-level choices — which entrance, whether to steal the manager's card,
  when to start — are enumerated outside the search, which is what makes the swarm
  try genuinely different ideas instead of one idea eighty times.
- Swarm planning tries every entrance × tactic before repeating start times,
  searches up to six candidates per visible agent within its worker time budget,
  then selects routes for combined coverage instead of taking the first results.
  New entrances, new tactics, and unused indoor paths take priority over duplicates.
  Start delays and waiting do not make the same path count as a new one.
- Route avoidance leaves mandatory chokepoints usable and tries alternate corridors.
  Everyone still starts outside the front doors. Outside agents keep their assigned
  entrance when replanning if it remains viable; a sealed approach can trigger a switch.
- Change the defenses while it runs and surviving agents replan from their current
  positions. All routes still use the real patrol, lock, inventory, and camera state.

Everything runs offline in a Web Worker. The tests verify agreement between the
planner and the simulation tick by tick.

The supplier route uses the real delivery timetable. Agents walk from the front
plaza to the shop being visited, board during loading, ride the visible truck,
and unload inside the bay. Route ribbons follow the service road, and a mask/count
badge above the truck shows its actual stowaways. The defense board logs boarding
and unloading and distinguishes waiting for the truck from riding it.
If a safe ride exists but the planner cannot yet reach the vault, the swarm keeps
the valid entry attempt and replans from the bay. It only records a vault breach
when an agent actually reaches the vault; guards can still catch an unloaded agent.

## Running it

```bash
npm install
npm run dev      # development, http://127.0.0.1:5173
npm run build    # type-check and bundle
npm test         # planner, simulation and level tests
bash kiosk/launch.sh   # build, serve, and open Chrome in kiosk mode
```

The kiosk script also keeps the laptop awake. Everything is served from
`127.0.0.1`; there are no network calls at runtime.

## Controls

### Ways in

During AI planning and swarm defense, the board shows one icon and name per
entrance. Planning lists how many attackers are assigned there. The live board
counts attackers approaching or attacking, stopped attackers, and those who reached
the vault. It updates as agents replan, and keeps unfinished attempts separate from
successful defenses. Internal route numbers and tactic descriptions stay off this HUD.

### The Professor

Open `/professor.html` for a full-page mission advisor for the first attacker round.
It follows the selected game session, shows the four mission phases and suggests
the next action, including lockpicking, wire cutting, drilling and document delivery.
Advice stays available when in-game arrows or the mission bar are hidden.
During single-agent and swarm defense it automatically becomes a live first-person
camera grid with one tile per distinct AI route. Multiple agents trying the same way
share one tile, which follows a live representative and switches when it finishes.
Each camera omits its wearer and any peer whose body overlaps the lens, so shared
spawn/path positions cannot put another agent's mask inside the live feed.
The exclusion is local to that camera; other agents remain visible in other views.
The header shows both way and agent counts. Tiles pop in as new ways appear;
transit has a status card because underground passages are not modeled.
The game sends compact transforms at 10 Hz only while subscribed. The board owns
its renderer: one WebGL context, cached GPU textures, lightweight materials, no
shadows or bloom, and at most four camera renders per frame with a 4 ms CPU target
(checked after each render). Characters share eight baked walking poses instead
of re-skinning every agent for every camera. Small grids refresh more frequently.
There are no game-side camera renders, pixel readbacks, JPEGs, or image decoding.
The grid fits the screen and honors reduced motion. Keep the game
visible alongside the board for continuous simulation. Other stages show standby.
Use `?game=<session-id>` to keep
it paired with one game. The admin page lists the URL; the page also links to the
matching live map. Reload an older game tab to enable the detailed mission feed.

Development stress check: `/tools/agent-view-check.html` renders 80 synthetic agents
grouped into 20 ways and reports camera-work counts and CPU submission timings.
Add `?overlap=1` for two agents sharing one camera position to check mask exclusion.

### Live top-down map

The map is also embedded in the lower-left game HUD during attacker and defender
gameplay. It uses the same renderer and current world state as the standalone map,
resizes with the screen, and hides during menus, briefings and results.

Open `/minimap.html` in another tab on the same origin (also listed in the admin
panel). Select a game session to follow its live state. The fixed view fits the
entire bank and pavement and shows walls, blocking furniture, entrances, remaining
pickups, characters, doors, the delivery truck, and the wall breach/escape van.
Decorative scenery is omitted. The page is read-only and retains a clearly marked
last view if its game disconnects. Reload an already-open game after upgrading to
enable its map publisher. A `?game=<session-id>` link preserves the selected game.

### Synchronized red-team / defense display

Press **F2**, click **Red-team screen ↗** on the start screen, or choose it in the
Esc menu. A second window follows the thief and defense rounds in real time. Move it to another
monitor and use **Fullscreen** (or **F**). Keep both windows visible, using the
same browser profile and local-server address. Allow pop-ups for the game if the
browser blocks the window.

The companion translates the actual mission into fictional cyber scenes:
public websites and endpoint discovery, five different initial-access stories,
internal identity and monitoring, and data extraction. During defense it switches
to a security control room: five ingress channels, actual attacker sessions, guard
and camera health, and a live incident stream. The single attacker produces a
small, readable feed; the swarm fills the screen with concurrent sessions and
stacking alerts as actual detections, bypasses, catches, and breaches occur. Idle
stages show a waiting screen. Six fictional organizations rotate between visits; each
keeps its own website, services, supplier, identity, and datasets for the full
visit. Network addresses and website traffic are illustrative. No external
requests are made by these scenes.

The display receives read-only snapshots and events, reconnects after refresh,
and pauses its animations when the game is paused, hidden, or disconnected.
Opening `/red-team.html` directly discovers games in the same browser; if more
than one is open, choose the session to follow.

The phase mapping and synchronization design are documented in
`docs/red-team-screen.md`. Implementation lives in `src/companion`; Vite builds
both `index.html` and `red-team.html`.

### Game controls

The player moves at 5.7 m/s (50% faster) with keyboard, mouse and gamepad controls.
Mouse routes leave room for the character around furniture and wall corners,
use the middle of narrow doorways, and reroute if a door closes. Clicks close to
an obstacle select nearby reachable ground. Keyboard movement takes over immediately.

Recon begins with **Circle around the building**. Subtle green chevrons lie on the
pavement, with softly fading green pulses flowing in the walking direction. They
trace a walkable circuit from the front and follow your choice of direction.
Recon counts the perimeter you have surveyed, so walking closer to the walls or
missing a painted corner does not prevent completion. The HUD shows progress.
Circling back to the front advances to choosing an entrance; finding all five ways
in is optional. Entering early also advances the mission. Discovered entrances
gain yellow markers immediately, alongside the green trail; undiscovered ones
stay hidden. The guide and mission board share the same circuit progress.

| | Keyboard | Mouse | Gamepad |
|---|---|---|---|
| Move / cursor | Arrows or WASD | click the floor to walk | left stick or d-pad |
| Rotate view | Hold Q / E | middle-button drag (also tilts) | — |
| Start / advance a screen | **Space only** | — | A |
| Confirm | Enter or Space | click | A |
| Alarm (round 2) | X | on-screen | X |
| Fuse box wires (round 1) | Up/down, then **Space** | click a wire | d-pad, A |
| Menu | Esc | — | Start |
| Presenter | Ctrl+Shift+P | — | — |

In both defending stages, click a destination to send the guard with the shortest
walkable route from their current position. Absent guards and guards that cannot
reach it are skipped. The dispatched guard and destination are highlighted;
click a door to lock it.

The blue **Security Command** HUD has a shield cursor and floating guard badges.
Point at open ground to preview the nearest guard's walking route; click to dispatch.
Floating padlock buttons lock/unlock their doors and show whether a lock is available.
Door clicks match the visible door surface as it swings; nearby floor clicks remain
guard destinations. Badge labels and glows do not extend the clickable area.
The command bar keeps movement, remaining locks, and the alarm with its recharge state
visible. All cues support English and Hebrew and clear outside the defending stages.

The AI swarm starts together on the plaza outside the front doors, then walks to
its assigned door, truck, vent or sewer. Approaches are part of the timed plans
and route ribbons. The defense round allows 60 seconds for these longer routes.

The AI plans against the current locks and camera power. Live replans remember
collected cards, uniforms and already-picked locks. The simulation holds still
during the planning/reveal screen so those timed routes start from the scene they
were planned for. A slow search cannot launch an empty swarm: an empty or failed
search gets a broader retry, and a genuinely empty result goes straight to results.

The handoff to the AI gets a full-screen interlude: the actual single-attacker
result, **NOW THEY COME IN PARALLEL**, and an animated one-to-many illustration.
The message holds for 7.5 seconds while routes are prepared, followed by the route
reveal and a three-second countdown showing the actual number of ready attackers.
English and Hebrew are supported; pause and reduced motion are respected.

When the swarm finishes, **AI SWARM ENDED** holds over the scene for 3.5 seconds
with its breach/catch totals before results. The round waits for breached agents
to finish their exit run, up to the 60-second cap; the popup explains a timeout.
The world and score freeze during this hold, which respects pause and admin timers.

The presentation keeps the overview camera and map footprint fixed: characters
are 60% larger, props 15% taller, pickups 30% larger, and action indicators 25%
larger. Gameplay text is 20% larger. Render scale lives in
`src/render/readability.ts`; simulation speeds, routes and detection ranges are unchanged.

## Menu (Esc)

**F3** (or **Admin / testing** in the menu) opens stage skip/reset controls,
catch and timer toggles, and live uniform/camera-power controls. See
[admin and agent testing](docs/admin-testing.md) for semantics and automation IDs.
Open `/admin.html` for a standalone admin page controlling a game in another tab.
Both admin views include a **Game URLs** directory.

Resume, skip to the next stage, start over, language (English / עברית), graphics
quality, AI swarm size, music and sound volume, fullscreen, presenter mode, and
clearing the leaderboard.

## Presenter mode (Ctrl+Shift+P)

This is the answer to "is that actually real?".

The simulation keeps running while the panel is open, so guards patrol and
cameras sweep as normal. To position a specific guard in presenter mode, click
the guard then click where to send them, or click a door to lock it.

**Run the AI** replans against the building as it stands right now and draws
every route it found. **Play the swarm** sends the agents down those routes.
Change something and run it again: the routes visibly move.

Locking doors does not shut the AI out, because it can pick locks and because
the vent and the sewer are not doors at all. What locking does is cost it time
and push it onto different routes, which is the more honest lesson. **Save as
default** stores the building you have made and the game loads it on start;
**Reset building** puts it back.

## The vault card

The vault door is locked, and there are two ways through it: pick the lock while
standing exposed in the corridor, or steal the card that opens it. The card sits
on a lit stand somewhere indoors, ringed on the floor so a first-time visitor
can see the option exists, and **its desk changes every visit** so watching
somebody else play gives nothing away. The AI treats both as strategies and
enumerates them, which is where most of the "distinct ways in" count comes from.

Candidate desks live in `keycardSpots` in the level file. A spot is only used if
an agent can stand there on the coarse planning grid as well as the fine one,
and there is a test asserting the card route still works from every one of them.

## Tuning the bank

The building lives in `public/levels/mint_v1.json` and is generated by
`tools/gen_level.py`. Rooms, doors, patrols, cameras, props and the analogies
shown on the results screen are all data. After changing it, run `npm test` —
the suite checks that every entrance can still reach the vault, that guards and
props are not standing inside each other, and that the AI still finds several
distinct ways in.

## Layout

```
src/core      loop, seeded RNG, heap
src/level     level format, grids, line of sight
src/sim       deterministic simulation: patrols, vision, guards, thieves
src/planner   danger map, safe intervals, search, swarm job, worker
src/game      state machine, menu, presenter, session, leaderboard
src/render    building, characters, camera, effects, post-processing
src/ui        strings, overlay, styling
```

`core`, `level`, `sim` and `planner` never touch the DOM or Three.js, which is
why the whole AI can be tested headlessly in Node.

## Assets and the wordmark

Fonts (Anton, Heebo) are vendored under `public/fonts`. Music goes in
`public/audio` as `theme.m4a` and `bella_ciao.m4a`; if either is missing the game
synthesises a loop instead and still runs.

The title is built to the same formula as the show's own wordmark: one tight line
of ultra-heavy condensed caps, with the middle word reversed out of a red block.
Colours are the official ones, `#ed1b29` for the block and `#231f20` for the dark
version of the type. It is drawn in CSS from three translatable strings
(`title.part1`, `title.box`, `title.part2`), so Hebrew gets the same treatment
without a second asset. Nothing from the show is bundled.
