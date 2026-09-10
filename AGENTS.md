# La Casa de Datos — handoff notes (written 2026-09-08, 4 days before the conference)

## Agent gameplay testing controls
Read `docs/admin-testing.md` before interactive gameplay testing. Use F3's admin
panel to start/reset/skip stages, disable catches and stage timers for exploration,
and change uniform or camera power. Use its accessible labels/stable test IDs;
do not mutate private runtime state. Close the panel before movement and reopen
it to pause or inspect status. Reload after testing to restore normal defaults.
Alternatively open `/admin.html` to control a separate game tab without rendering
the game on the admin page. Select the game session and wait for command acknowledgements.

Read README.md first for the game's structure. This file is the context that isn't in the README:
what the game is for, what hardware it runs on, what was decided, and what to do next.

## Purpose
A booth/station game for an AI conference that explains **red teaming** to a non-technical audience.
The metaphor: pentesting a company is like breaking into a bank. The payoff moment is the results
screen — "You found 1 way in, in 41 s. The AI found 12, in 0.2 s." — followed by the analogies
(`analogy.*` in `strings/*.json`) that translate each entrance into everyday life (phishing email,
forgotten old system, supplier access, missed update, leaked password). That moment is the whole
point; everything else exists to set it up.

## Decisions already made (do not relitigate)
- **Keep this three.js/TypeScript game. Do NOT rebuild, and do NOT move to Unreal/Blender-based
  third person.** A photoreal rebuild was started and abandoned; there is no time and the audience
  won't notice textures. The planner, two-round flow, presenter mode, tests and kiosk mode are the
  value here.
- Visual style is intentionally low-poly/procedural (`src/render/building.ts` builds every prop
  from boxes/cylinders in one `switch (p.kind)`; characters are instanced in `characters.ts`).
  If nicer assets are wanted, the cheap path is a few **hero props as glTF from Blender** (vault
  door, presses, statue, truck, guard/thief) swapped into that switch via `GLTFLoader`. Nothing
  else about the pipeline changes. This is a last-priority item.
- Playable in ~3.5 min, restartable instantly, no network at runtime, Space-only to advance.

## Venue hardware
- **Three 55" screens side by side**, driven by a **Windows PC**. Effective canvas 5760×1080
  (or 11520×2160 if the panels run at 4K — prefer 1080p per panel for performance).
- Displays are probably merged with NVIDIA Surround / AMD Eyefinity into one desktop; if they are
  three separate extended displays, launch Chrome borderless with
  `--window-size=5760,1080 --window-position=0,0` instead of `--kiosk` (kiosk/fullscreen only
  covers one monitor). Confirm which on site.
- `kiosk/launch.sh` is macOS-only (`caffeinate`). A Windows launcher (`kiosk/launch.ps1` or
  `.bat`) is needed: `npm run build`, `vite preview --port 4173 --host 127.0.0.1`, Chrome with
  `--kiosk` or the borderless flags above, `--user-data-dir` to a temp profile, and keep-awake
  (`powercfg` / presentation settings).

## Known findings from code review
- `src/render/camera.ts` `refit()` takes `max(dh, dv)`. At 48:9 the vertical fit dominates, so the
  bank sits in the middle third and the outer screens are empty asphalt/sky. This is the reason the
  wall doesn't "wow". Fix by giving the wide layout its own framing, not by changing engines.
- Bank grid is 96×64 (wider than tall) — good for a wide wall if the long axis runs across the
  screens (azimuth ≈ 90, low pitch, like the `facade` shot).
- Post-processing (bloom) + PCF soft shadows at 5760×1080 with pixelRatio 1 ≈ 4K workload; fine on
  a decent GPU. The quality setting in the Esc menu already exists to drop it if needed.
- `npm test` passes (45 tests) and `npm run build` is clean as of 2026-09-08.

## Plan for the 4 days, in priority order
1. **Play-test the whole flow on the real machine** and fix flow/feel bugs first (the user says the
   game "feels cheap and buggy" — get a concrete list by playing: attract → brief1 → round1 →
   r1result → brief2 → round2a → aiThink → round2b → results). Make the results screen land hard.
2. **Wall preview mode** for developing on a laptop: a `?wall=3` URL param that forces a 48:9
   canvas, letterboxes it, and draws two thin lines at the panel boundaries (x = 1/3 and 2/3).
   (Meanwhile Chrome DevTools device toolbar at 5760×1080 works as a stopgap.)
3. **Use the width.** One canvas, three scissor viewports rendered from the same scene each frame:
   - centre: gameplay as today, all UI pinned to the centre third so controls never change;
   - left: "what the human sees" — guard/security-camera view with vision cones;
   - right: "what the AI sees" — danger map over time + every planner route drawn live
     (the presenter mode already has the route-drawing and replan hooks; reuse them).
   Attract loop: one wide cinematic camera across all three panels with the swarm streaming
   through, slow orbit.
4. **Windows launcher** (see above) and a test on the actual PC and screens.
5. **Fallback video** recording of a full run, in case hardware fails.
6. Optional, only if time remains: Blender hero props as glTF.

## Housekeeping
- `_src_snapshot.tgz` in the project root is a temporary source snapshot made during the handoff;
  safe to delete.

## Added 2026-09-08 (evening): assets, textures, new breach mechanics
- **glTF models** live in `public/models/` (CC0, credits in `CREDITS.md` there). `src/render/models.ts`
  loads and normalises them; `building.ts` swaps them in per prop kind (`PROP_MODEL`), `city.ts` uses
  the cars. Guards and thieves are one rigged Quaternius figure (`man_suit.glb`) recoloured by
  material name and baked to vertex colours; `characters.ts` `SkinnedCharacterBatch` cross-fades
  idle/walk/run from the sim speed. The box figures remain as the fallback if a model fails to load.
- **Wearables**: `tools/blender_wear.py` makes the guard cap, duty belt, pistol, thief hood and Dalí mask
  in metres; `dress()` in `models.ts` binds each rigidly to a bone (Head / Hips / PalmR) in the rig's
  bind space and the merge folds them into the one skinned mesh. Bone names lose their dots in three.js.
- **Blender**: `tools/blender_props.py` generates `vault_door.glb` (child named `Wheel` spins) and
  `press.glb`. Run headless with the command in the file's docstring. Blender 5.2 is at
  `/Applications/Blender.app`.
- **Procedural textures** in `src/render/textures.ts` (marble tiles, wood, concrete, asphalt, plaster)
  with normal maps; geometry gets world-space UVs via `worldUV`.
- **Two new ways in**, both usable by the human in round 1 and by the planner: a staff uniform
  (`k_uniform`, guards recognise the wearer only within 30% range, cameras ignore him) and the fuse box
  (`k_fuse`, cameras dead for the rest of the round). They are `keycards` entries with a `kind`.
  Planner: `TWO_LEG` strategies in `planner.ts` plan the second leg on a variant danger map;
  `DISGUISE_RANGE_MUL` must match `src/sim/world.ts`. The AI now finds ~20 distinct ways, not 12.
- **AI phase**: each distinct way is a named row in the ways panel plus a coloured ribbon
  (`WayRibbons`); rows get BREACHED / HELD during the swarm.
- Round 1 now uses a follow camera (`follow` shot) and the player has a 3 s grace after spawn.

## Added 2026-09-08 (late): wave A and the vault door
- **The vault door has no lock to pick.** `d_vault` carries `"pickable": false`; the planner's
  `doorCost` and the sim's `adjacentLockedDoor` both refuse it. Every route therefore collects the
  manager's card first: `runLegs` in `planner.ts` walks optional item -> card -> vault. This is the
  exhibit's "one control that always holds", and the AI gets past it every time by stealing a credential.
- **Card placement drives the whole round's timing.** Routes are 20-35 s when the card sits in the
  lobby/corridor and 43-58 s when it sits in the manager's office, against a 45 s round. `keycardSpots`
  is now only the fast spots; re-measure before adding any. The old spots are in git history.
- **Wave A** plans at machine speed (a walking-pace plan is not findable once the card is mandatory)
  and is walked at `WAVE_A_RATE` 0.75 via the new `Thief.planRate`. He does not replan, so a guard the
  visitor moves is one his plan cannot know about; the swarm does replan, which is the contrast.
  Untouched he is caught around 18 s, which is the window the visitor gets. The verdict then holds for
  `TIMERS.round2AResult` before the AI's turn, instead of cutting on the same frame as the catch.

## Added 2026-09-09: view rotation and the plaster-block bug
- **Middle-drag rotates the view.** `InputManager` reports `state.orbit` (pixels of middle-button
  drag, consumed per frame); `main.ts` feeds it to `CameraDirector.orbitBy`, which layers a
  visitor azimuth/pitch offset on top of the current shot. Grab-the-world direction, pitch clamped
  to 6-86 degrees. A `cut()` clears the offset and a `moveTo()` eases it away, so every stage
  transition still restores the scripted framing and the kiosk cannot be left pointing at the sky.
  `screenToWorldDir` uses the rotated angle, so arrow keys stay screen-relative.
- **The building no longer plasters over its own furniture.** `wallRuns` in `building.ts` built a
  2.6 m (6.2 m outdoors) plaster box on every unwalkable cell — and step 5 of the loader carves
  solid props out of the walk grid, so every crate, press, cabinet, street lamp and the truck wore
  a wall. That was ~40% of the wall geometry and the reason the plan read as a heap of anonymous
  blocks. The loader now also publishes `level.wall`, the structure as it stands before props are
  carved, and the renderer builds from that. `shellFacing` uses it too, so a car parked against the
  shell no longer changes how that wall is classified. Guarded by tests in `tests/level.spec.ts`.
- `window.casa` now also exposes `input`, for poking at the drag state on the fair laptop.

## Added 2026-09-09 (later): doors, and a longer round 1
- **Doors only swing for someone crossing them.** `someoneCanPass` in `worldView.ts` used a 2.75 m
  radius around the door centre, so any guard patrolling past set the leaf swinging — most jarringly
  the vault door, which opened whenever the vault guard walked by. `src/level/doorway.ts` now judges
  it in the door's own frame: `along` (across the opening) must be inside the mouth, `through` (the
  way you travel) within 1.5 m, and the heading must actually close that gap — unless they are
  already standing in the opening, where the leaf must be aside whatever they face. Over 2000 ticks
  of patrol with nobody in the building, doors swing on 1.3% of door-ticks instead of 11.4%.
  Note this only ever governed *locked* doors: an unlocked one still stands permanently open, which
  is deliberate — what you see and what you can walk through are the same thing.
- **`TIMERS.round1Cap` is 180 s** (was 75 s). `formatClock` already renders minutes, so the HUD reads
  `2:59.4`. Two knock-ons: a full run is now ~5.5 min rather than ~3.5, and `TIMERS.idleGameplay`
  is still 45 s — a visitor who stops to think for 45 s of their 3 minutes is dropped back to the
  attract loop. Raise it if the longer round is kept.

## Added 2026-09-09 (later still): the round 2 bugs
One root cause behind "the thief never existed, then it said I caught him, then the AI found no
ways in", plus three things that turned it into a mystery:
- **The worker threw away routes it had already found.** `runChunked` in `planner/worker.ts` only
  flushed its batch at `CHUNK` (12) or on the last request — but the loop also `break`s on the time
  budget, and everything found since the previous flush was then dropped, while `done` still
  reported it in `stats.found`. On a slow frame the planner would report "found 2" and deliver
  none. That is wave A failing to spawn *and* the swarm arriving with no ways in, from one bug.
  Batching now lives in `planner/batch.ts` (`PlanBatcher`), whose whole contract is that everything
  added is eventually emitted; `tests/planbatch.spec.ts` pins it. `stats.searches` now reports the
  searches actually run, not the number requested, so budget starvation is visible.
- **A cancelled planner job looked like a successful empty one.** `PlannerClient.cancel()` resolved
  the promise, so "a newer job took the worker" and "there are no routes" were indistinguishable.
  The result now carries `cancelled`. This mattered because `spawnWaveA` issued its fallback job
  without re-checking the state: entering the AI phase while wave A was still planning had the
  fallback cancel the swarm's own job, and the exhibit ran with zero routes.
- **A thief stuck at a door vanished silently.** `tendBlockedThieves` set `active = false` with no
  event, so `waveA` stayed `pending`, the round idled to its 46 s cap and then showed
  `resultA.win` — "YOU CAUGHT HIM" — for a man who was never caught. Wave A never replans, so a
  shut door is the end of his route: he is now held for 3 s (9 s still in round 2b, where a replan
  may arrive), then `world.abandonThief` retires him with a `thiefDone` reason of `'blocked'`.
  The verdict gains `'held'` and its own banner, `round2.resultA.held` — **new Hebrew copy, worth
  checking**. If no walker can be planned at all the round no longer sits empty; it says so on the
  console and moves to the AI phase.
- `setupRound2A` resets `session.round2.waveA`; re-entering the round inherited the last verdict and
  settled instantly.

## Added 2026-09-09: the fuse box wire panel
- Cutting the power is now a mini-game rather than a walk-over pickup, in the same shape as the
  lockpick: `src/sim/wirecut.ts` holds the pure logic (`WireCutGame`), `world.ts` owns `activeWire`
  and `attemptCut()`, and the HUD panel lives in `index.html` / `style.css` / `overlay.renderWire`.
- Four wires, two of them live and visibly carrying a travelling spark. Cut both live ones and the
  cameras die. Cut an earth wire and it shorts: sparks, a noise the guards come to investigate, and
  the cutters jam for 0.7 s. Mercy opens the panel after 14 s, but only for somebody who cut something.
- Deliberately easy. The tension is standing still in a patrolled building, not the puzzle; the
  audience is non-technical and has three and a half minutes for the whole exhibit.
- Controls: up/down choose a wire, SPACE cuts, and walking sideways steps away from the panel (which
  is the only way out other than finishing it, since up/down no longer walk). Wires are also clickable
  via `overlay.onWireClick`.
- Only the player plays it. Plan-following agents still take the fuse through their `pickup` action,
  which is the point: the AI does not stand at a panel snipping wires.

## Added 2026-09-09: the supplier's truck
- **The loading bay is no longer a door.** `d_dock_outer` is `locked` with `pickable: false`, so it
  cannot be walked through or picked. The way in is the supplier's lorry, which is what the
  `analogy.dock` line has always claimed ("the supplier who is allowed into your network").
- **The delivery round** is authored in the level under `delivery` and simulated by
  `src/sim/truck.ts`. `truckPoseAt(def, tickHz, tick)` is a pure function of the tick, like a guard's
  patrol program, so tests and the planner agree with what is on screen. The truck leaves the bay,
  drives the service road ring to one of five shops (chosen per round by a hash of the cycle index),
  loads for 8.5 s, drives back and unloads. One cycle is 45 s; whatever is left over it spends parked.
  A constraint worth keeping: `2 * legTicks + loadTicks + unloadTicks` must fit inside `cycleTicks`
  for **every** shop, or the truck teleports at the wrap. There is a test for it.
- **Stowing away**: stand next to the truck while it is loading and SPACE climbs into the back.
  The player is `hidden` for the ride, follows the truck, and is put down in the bay when it unloads.
  SPACE gets out again, but only while it is stopped. See `boardTruck` / `leaveTruck` in `world.ts`.
- **The gate opens for its own lorry** (`gateOpenForTruck`), which is a render-only concession.
- **For the planner** the ride is a portal, `p_truck`, from the first shop to the bay, costing 36
  quanta. The `dock` entry spawns at that shop and its kind is now `truck`. The AI therefore still
  has five ways in and about 6 of 45 routes ride the truck. It is an approximation: a plan-following
  agent goes hidden at the shop and reappears inside rather than being synchronised to the truck's
  actual position. Synchronising it would need time-gated edges in the SIPP search.
- The old static truck prop (parked inside the north wall) is gone; there is a new `store` prop for
  the shopfronts.

## Added 2026-09-09: item cues
- One channel for "there is something here you can do": `Cue` in `src/ui/overlay.ts`, rendered into
  `#h1-cue`. It arrives big enough to interrupt, holds for `CUE_BIG_MS` (1.5 s), then shrinks to a
  chip that stays while the offer is open. A new `key` is a new offer and replays the entrance, so
  the timing lives in the overlay and the flow only has to say what the offer is.
- `roundOneCue()` in `flow.ts` picks one, in priority order: the mini-games suppress it entirely
  (they have their own panels), then riding the truck, then a one-off event cue (`showCue`, ~4.5 s,
  used for taking the uniform or the card and for the lights going out), then boarding the truck,
  the sealed vault, and finally an item lying within 4.5 cells.
- `waiting: true` means the offer is real but not available this second: the key greys out and stops
  pulsing. That is how the ride cue reads while the truck is between stops.
- The bottom prompt is for persistent status ("you are in a staff uniform"); the cue is for things
  to do now. Do not say the same thing in both.

## Added 2026-09-09: the mission board (cyber comparisons in play)
- The exhibit's argument now runs *during* round 1 instead of waiting for the results screen. Top
  right: three phases in the order an intrusion actually goes, each line carrying the heist action
  and the same move in security terms.
- `src/game/missions.ts` holds it. `MissionTracker.update(world, level, player)` recomputes the board
  from world state each frame and returns objectives that appeared on that call, so the flow can pop
  a cue for them. `note(event)` records which way in was actually taken, because position alone
  cannot tell a sewer from a front door.
- **Recon**: circle the building (three sides) and find two ways in. **Initial foothold**: the ways
  in, which are hidden until the thief walks within `DISCOVER_CELLS` of them; that is the whole point
  of the phase. **Lateral movement**: cut the power, wear the uniform, take the card, reach the vault.
- The comparisons: sewer = 0-day, side door = 1-day, supplier's truck = supply chain, roof vent =
  unpatched service, front doors = phishing, cut the power = disable the AV, uniform = evade the AV,
  card = steal credentials, vault = crown jewels. A legend under the board reads guards = antivirus
  and cameras = syslog, colour-matched to their vision cones.
- Getting inside closes the recon phase whether or not it was finished, so a visitor who rushes
  never sees a stale "still looking around" board.
- Round 1 only. Round 2 has its own ways-in panel in the same corner, so they never collide.

## Fixed 2026-09-09 (late)
- **The manager's card never disappeared.** Two `case 'pickup':` labels had ended up in the same
  `switch` in `tickSim`, and the earlier one shadowed the one that calls `view.markKeycard`. Same for
  `powerCut`. Worth remembering when adding event handling: the switch is long, so grep for the case
  before adding one.
- Taking a card now lifts it, spins it and shrinks it away over `CARD_EXIT_SECONDS` instead of
  blinking off (`cardExit` in `worldView.ts`).
- **Guard cones now show the disguise.** While the thief wears the uniform and the alarm is down, the
  cones are drawn at `DISGUISE_RANGE_MUL` of their range, which is the distance at which a guard
  would actually recognise him. Measured: 7.99 normally, 2.39 disguised, 11.99 with the alarm up,
  since the alarm cancels the disguise in `detect()`. The constant is exported from `world.ts` so the
  renderer and the simulation cannot drift apart.

## Added 2026-09-09: camera beams
- Each camera now casts a thin red beam from its lens down to a soft spot on the floor, built into
  the camera pivot in `building.ts` so it sweeps with the housing for free. `worldView` ties its
  visibility to the cone's, which means it dies when the fuse box is pulled: a camera with no beam
  is a camera with no power.
- It is deliberately a **short aiming beam** (4.5 units), not the camera's full range. A first
  attempt trimmed a full-length beam to the first wall using a floor-level raycast, which was the
  wrong model: cameras sit 3.4-4.4 units up and look over props that block the sight grid, so the
  beam collapsed to nothing next to the printing press. The cone on the floor states the real
  coverage; the beam only says which way the camera is looking.
- Material `beamRed` is kept faint (opacity 0.26) because bloom multiplies it and a hot line across
  a hall reads as an alarm rather than as a camera.

## Fixed 2026-09-09: camera cones were nearly invisible
- The real cause was not colour. Camera `c1` sat at [34,11], inside the sight-blocking radius of the
  printing press at [37,14], so `coneSamples` clipped its cone to **0.69 world units of a 10-unit
  range**. It had been rendering as a dot. Moved to [44,11] facing 0 with a 45-degree sweep, looking
  along the north side of the vault hall: reach is now 10.33.
- Placement matters more than it looks. [48,11] facing 90 gives the longest sight line (13.5) but
  points straight down the hall at the vault, and the swarm collapsed from 45 plans to 18 and 31
  breaches to 10. The search that found [44,11] rejected any placement that can see the vault cell
  at any point in its sweep. Re-run `npm test` after moving a camera; timing.spec catches this.
- **Cones now have a bright rim** (`RIM_WIDTH` in `fx.ts`): a band along the outer arc, drawn as a
  child of the fill mesh so it inherits visibility. A flat wash at 22% opacity disappears into a
  near-white marble floor; an edge is what makes the shape read.
- Cameras are **cool teal**, guards **warm amber**, which matches the mission-board legend and means
  a glance tells you whether a machine or a person is looking. Both use a darker fill under a
  brighter rim, because on a bright floor contrast has to come from both directions.

## Changed 2026-09-09: the shops on the service road
- The shop that stood on the south plaza (cell [34,63]) is **gone**, along with its delivery stop
  [34,60]. It sat between the visitor and the front door and read as clutter at the one place the
  camera frames every round.
- The remaining four shops carry a **lit roof sign** — a dark board over the awning with a neon
  logo drawn on canvas (`src/render/signs.ts`, `signMaterial(kind)`), a monitor for the computer
  shop and a burger for the food shop. No words: the game runs in two languages. The kind is
  authored per prop as `"sign": "computer" | "food"` (`SignKind` in `level/schema.ts`).
- The board is one plane per side, merged, sharing one material per sign kind, so all four shops
  cost **two draw calls** after `collapse` merges by material. The map is also the emissive map, so
  only the neon glows and the board stays a dark rectangle at night.
- Removing a delivery stop changes `stopForCycle`'s hash and therefore which shop the lorry visits
  on each round. Timing held (45 plans, 31 breaches, first breach 19.2s), but re-run `npm test`
  after touching `delivery.stops`.

## Fixed 2026-09-09: the camera beam went through walls
- `c1`, the camera watching the vault hall, punched its laser clean through the building's north
  facade and put a red spot on the pavement outside. It happened on **87 of its 200 sweep ticks**:
  the beam was a fixed 4.5-unit line baked into the pivot, so it swept through whatever stood in
  front of it.
- `beamHit` in `building.ts` now marches the ray and stops at the first wall **taller than the beam
  is at that point**. Height is the whole trick, and it is why the earlier attempt failed: the sight
  grid (`opaqueNow`) is flat, and a camera hanging at 4.2 m looks straight over the presses and
  counters that block it, so trimming against that grid collapsed the beam to nothing. Only built
  walls stop a beam, and only where they are tall enough.
- `wallTops(level, cut)` bakes the two wall-height maps at build time — the cutaway takes the
  near-side shell down to `STUB_WALL_H`, and a beam that stopped at a wall that is no longer on
  screen would look broken. `setCutaway` switches which map `aimBeam` uses.
- The shaft is a **unit cylinder scaled to length**, not rebuilt geometry, and `worldView` calls
  `building.aimBeam(i, facing)` every frame beside the pivot rotation. When the beam ends on plaster
  the spot stands up and faces back down the beam — a dot on the wall; when it reaches the floor it
  lies flat as before.
- `tests/cameras.spec.ts` walks every camera through its whole sweep, in both shell states, and
  fails if any sample crosses a wall taller than the beam. A second test fails a camera whose whole
  sweep is against a wall, since a beam trimmed to a stub says nothing about where it is looking.

## Added 2026-09-09: data exfiltration (round 1, phase four)
- **All four sections are on the board from the first frame**, and the section title is the
  security term (`DATA EXFILTRATION`) with the heist phrasing under it, the same way `RECON` and
  `LATERAL MOVEMENT` read. Half the arc hidden makes no argument. Standing anywhere in
  `vault.rect` hands the board to the last section, overriding the usual first-not-done rule: the
  optional lateral moves stop mattering once you are in the vault.
- **Reaching the vault no longer ends round 1.** It still sets `breached`, which is the number the
  results screen compares against the AI, and a plan follower is still retired by it. For the player
  it opens the fourth mission section: the money has to leave the building. Three verdicts now —
  never got in, got in but nothing left, the money is out — and the middle one is the lesson.
- `Thief.retired` was split out of `breached` for this. Detection and `catchThief` test `retired`;
  a player carrying cash to the van is still catchable, which is the whole point.
- **The drill** (`src/sim/drill.ts`): hold SPACE, the bit heats, let go before it screams. Overheat
  jams it, costs progress and makes a noise the guards walk to. Patience beats brute force, and
  there is a test that says so — that is the comparison the phase is making about a channel out.
  Progress survives being chased off the wall (`wallGame` in `world.ts`).
- **Placement is the whole difficulty knob.** The drill spot must be somewhere a camera does not
  sweep: at x>=46 on that wall the vault camera sees it and a guard has you in 1.7 s. [43,10] is
  camera-free with the nearest guard waypoint ~6 cells off. Re-survey before moving it.
- **The breach takes a wider span of wall than the gap** (`HOLE_SPREAD` in `building.ts`). It has
  to: the north shell stands full height in the cutaway, and a 6.2 m wall over the hole hides the
  van from the only camera angle the visitor has. `wallTops` gets a third variant so the camera
  beams stop at the collapsed height and not at plaster that is no longer there.
- **`PRESS_REACH` is 6.2 cells, measured from the press's centre.** The press blocks a 2-metre
  radius — four cells — so the closest anyone can stand is about 4.1. The first version used 2.6 and
  the money could not be picked up at all; every test that teleported the player onto the press cell
  missed it. `tests/exfil.spec.ts` now finds the nearest *passable* cell to each press and takes a
  load from there, which is the check that would have caught it.
- **The van** is white, 5.6 m, with a cargo box, side shutters and a lit rack. The `suv` model's
  length runs along its own z while the simulation measures facing along x, so it is turned a
  quarter inside a wrapper before being scaled — same trick as the `yaw` in the truck's `PROPS` spec.
- Carrying is signalled three ways, because at this camera angle one is easy to miss: an oversized
  bundle held at chest height, a gold glow, and a ring on the floor. Being caught drops the bundle
  and keeps whatever already reached the van.

## Added 2026-09-09: the phase glow
- Whatever the mission board is asking for is **outlined in the building**: a glowing green rim
  around the door, the sewer hatch, the keycard, the lorry, the van, the wall about to be drilled.
  `OutlineGlow` in `fx.ts`, colour in `PALETTE.highlight`.
- **Green because nothing else in the building is.** The alarm and the thieves are red, the guards
  amber, the cameras teal, the money gold. A colour with no other job cannot be misread as one.
- It is an **inverted hull**, not a post-processing pass: the object's own geometry, pushed out
  along its normals and drawn back-faces-only, so it shows exactly at the silhouette and nowhere
  else. Two hulls per object — a tight bright one and a wider faint one — because one line reads as
  a diagram and the wide one is what makes it a glow. Bloom does the rest. This matters on a
  three-screen wall, where an OutlinePass would be a second full render of the scene.
- **Each hull hangs off the individual mesh it outlines**, not off the object as a whole. The first
  version merged an object's meshes into one hull in the object's own frame, which was fine until
  the front doors swung: the leaf moved and left its outline standing in the closed position. Per
  mesh, a swinging leaf, a spinning vault wheel, a lorry on its round and a van pulling up all
  carry their own highlight with no per-frame bookkeeping.
- The swell is divided by the mesh's world scale, so a part of a glTF model scaled 1.76x does not
  get a 1.76x thicker outline than the box next to it. Its *size* comes from the whole object's
  bounding box, so one thing reads as one outline rather than a handle with a hairline and a door
  with a halo.
- **Effects are not part of the thing.** A hull swelled around the keycard's own beam is a pillar
    of light where an outline of a keycard was wanted. Anything with `depthWrite === false` — beams,
  halos, marker rings — is skipped, which is the convention every effect in this codebase follows.
- The board and the map cannot drift apart, because the objective names the object:
  `Objective.mark` is a `MarkRef` (`door` / `portal` / `key` / `truck` / `van` / `breachWall` /
  `press`), and `worldView.objectFor` is the only place that knows which scene object that is.
  `activeMarks` is just the open, marked objectives of the active phase.
- **A way in that has not been found is never outlined.** Otherwise the walk round the perimeter,
  which is the entire recon phase, is over before it starts. Recon itself names nothing — circling a
  building is not a thing you can point at — so it falls through to the ways in already discovered.
- Two things had to come out of the static merge for this: the **exfil presses** are kept as
  individual objects (`building.namedProps`, four extra draw calls) because the glow points at one
  at a time, and the **vault's** mark resolves to the modelled slab rather than its hinge pivot,
  whose leaf is hidden.
- Cleared in `resetWorldForPlay` and `setupAttract`; round 1 re-sets it every frame, and no other
  state ever sets it.

## Fixed 2026-09-09: the hall was blown out
The building is white marble under half a dozen point lights, and in play mode the floor clipped to
paper white with a hole under every lamp. Four dials, in the order they matter:
- **`toneMappingExposure` 1.05 -> 0.86.** The single biggest one. ACES rolls off the highlights, but
  not when the scene is already feeding it values well over 1.
- **Play-mode point lights roughly halved** (vault 90 -> 52, lobby 88 -> 50, hall 78 -> 44, corridor
  72 -> 40). These have `decay: 2` over low ceilings, so past about 50 the pool under a lamp stops
  being a pool. The *night* values went slightly **up** (vault 46 -> 56, lobby 36 -> 44, hall
  24 -> 32, corridor 20 -> 27) to hold the attract shot's punch against the lower exposure — the
  attract loop was never the problem.
- **`scene.environmentIntensity` 0.55 -> 0.32.** The RoomEnvironment is there so brass and steel
  have something to reflect; at 0.55 it was acting as a second ambient light over the whole hall.
- **Gloss.** Textured marble roughness 0.5 -> 0.66 with `envMapIntensity` 0.7 -> 0.4, flat marble
  0.32 -> 0.55, metal 0.35 -> 0.46, brass 0.28 -> 0.38. A polished floor turns every one of those
  point lights into a flare.
- Bloom threshold 0.82 -> 0.9 and strength 0.62 -> 0.48, so only genuinely bright things bloom
  rather than the marble itself. Checked afterwards that the vision cones, the camera beams and the
  phase outlines all still read — they read better, with less to compete against.

## Added 2026-09-09: the dead-camera badge
- While the fuse is out, every camera wears a **lightning bolt with a strike through it** — a
  billboard sprite above the housing, drawn on canvas in `deadPowerTexture` rather than typed,
  because there is no character for "no power" and an emoji renders differently on the kiosk
  machine than it does on a laptop.
- It belongs to the same channel as the cone it replaces: shown only while `world.camerasDown` and
  only when cones are on show, so nothing has to be turned off separately. It pops on arrival and
  settles, because the moment the fuse comes out is the one the visitor has to notice.
- Same pattern as the guard `?` / `!` glyphs in `worldView.ts`; `renderOrder` 20 with `depthTest`
  off so a wall never eats it.

## Added 2026-09-09: the swarm gets it out too
Exfiltration was round 1 only, which left the exhibit arguing four phases for the visitor and three
for the AI. Now every agent that reaches the vault picks the money up and walks it out.
- **The breach still fires at the vault**, with its `thiefDone`, so the ways panel, the breach count
  and the results screen are untouched. What changed is that the agent is no longer *finished*
  there: he gets `carrying` and an `exfilIdx`, and `stepPlanThief` hands him to `stepExfilWalk`.
- **One shared way out**, `SimWorld.exfilRoute`: a single A* from the vault to the van over a grid
  with the hole forced open, cached for the session. Not a plan each — the swarm going through the
  same hole in single file *is* the picture, and the planner's time budget is already spent finding
  the way in. Adding a fourth leg to `runLegs` would have pushed plans past `horizonSec` and thinned
  the swarm, which is the one number the round cannot afford to lose.
- **No drill for the machine.** The first agent to reach the wall opens it. The visitor's mini-game
  is the visitor's problem; a thing that has already decided does not fumble with a trigger. That
  contrast is the point.
- **A breached agent is retired but still active**: `retired` skips him in `detect` and `catchThief`
  while `active` keeps him stepping. Leaving him catchable was tried and pulled guards off the
  agents still trying to get in — 31 breaches fell to 26. The visitor carrying money in round 1 *is*
  catchable; that is where the tension belongs.
- Their floor discs turn **gold** while carrying, so the way out reads as a line of gold dots
  through the hole rather than more red ones.
- Measured on a full round: first breach at 19.2 s, 17 agents carrying at once by 22 s, the wall
  open at 22 s, 13 loads in the van by 24 s, ~100 by the cap. Round-2 timing is unchanged
  (45 plans, 31 breaches, median 26.9 s).
