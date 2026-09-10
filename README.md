# La Casa de Datos — The AI Heist

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
- Change anything while it runs and it simply plans again, in about 200 ms.

Everything runs offline in a Web Worker. The tests verify agreement between the
planner and the simulation tick by tick.

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

### Live top-down map

Open `/minimap.html` in another tab on the same origin (also listed in the admin
panel). Select a game session to follow its live state. The fixed view fits the
entire bank and pavement and shows walls, blocking furniture, entrances, remaining
pickups, characters, doors, the delivery truck, and the wall breach/escape van.
Decorative scenery is omitted. The page is read-only and retains a clearly marked
last view if its game disconnects. Reload an already-open game after upgrading to
enable its map publisher. A `?game=<session-id>` link preserves the selected game.

### Synchronized red-team display

Press **F2**, click **Red-team screen ↗** on the start screen, or choose it in the
Esc menu. A second window follows phase 1, when the visitor is the thief, in real time. Move it to another
monitor and use **Fullscreen** (or **F**). Keep both windows visible, using the
same browser profile and local-server address. Allow pop-ups for the game if the
browser blocks the window.

The companion translates the actual mission into fictional cyber scenes:
public websites and endpoint discovery, five different initial-access stories,
internal identity and monitoring, and data extraction. Outside the thief round,
it shows a static waiting screen until the next visitor starts. Six fictional organizations rotate between visits; each
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

Round 2 uses one grammar on every device: click a guard, then click where to send
them; click a door to lock it.

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
cameras sweep as normal. It uses the same click grammar as the defending round:
click a guard then click where to send them, or click a door to lock it.

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
