# Admin and agent testing

Open **F3** or **Esc → Admin / testing**. Opening the panel does not pause the
simulation. Use the Pause simulation checkbox when needed; closing preserves it.

Direct URL: **`/admin.html`** (for development, `http://127.0.0.1:5173/admin.html`).
This is a separate page with no game canvas or simulation. Open the game in another
tab on the same browser and origin, then select it in **Game session**. Controls
stay disabled until connected; acknowledgements confirm changes. Keep the game tab
visible (for example in another window) to avoid background-browser throttling.
The standalone page also works in the production
build and on port 4173. The panel's **Game URLs** list
contains clickable absolute links for the game, HTML entry, admin page, and
red-team companion, plus the highlight diagnostic when running the dev server.
Links open in new tabs so the current test session stays intact.

- Start round 1 starts a clean visit directly at playable round 1.
- Skip stage uses the normal stage order. Skipping AI thinking waits for routes.
- Reset stage reruns its setup. Resetting the swarm prepares fresh routes first.
- Restart visit returns to attract. Catches/timer overrides survive stage changes.
- Catches disabled prevents arrests for players and AI agents; guards still detect
  and pursue, and cameras still raise alarms.
- Timers disabled freezes stage clocks, result holds and idle resets. Simulation
  time, patrols, deliveries and mini-games keep running. Completed objectives can
  still end a stage. Use Skip stage for timed screens.
- Uniform changes the player's inventory and pickup visibility. The alarm still
  overrides its protection. Requires a player (use Start round 1).
- Power controls the cameras immediately. Disabled power stays off until restored
  or the world is reset. Uniform and power return to normal on a fresh round.
- Settings are in memory only. Reload restores normal catches and timers.
  The mission board is hidden by default; **Show mission board** restores it without
  affecting objective tracking or highlights. Its value lasts until game reload,
  and it can be changed even while paused. This display toggle alone does not mark a visit as assisted.
  Admin-assisted visits do not submit leaderboard scores.

## Agent workflow (browser UI)

Agents should use these controls instead of modifying private runtime state.
Press F3, click **Start round 1**, uncheck **Catches enabled** and **Stage timers
enabled**, then close the panel. Walk and rotate normally to inspect the scene.
Reopen F3 to set uniform/power or pause for a screenshot. Read the current stage
and applied values from the panel after every action. Do not assume async
planning has completed: `preparing routes…` means wait for the stage to change.

Stable DOM test IDs:

| Control | Test ID |
|---|---|
| Status | `admin-status` |
| Start round 1 | `admin-start-round1` |
| Skip / reset / restart | `admin-skip`, `admin-reset-stage`, `admin-restart` |
| Pause | `admin-paused` |
| Catches / timers | `admin-catches`, `admin-timers` |
| Uniform / power | `admin-uniform`, `admin-power` |
| Show mission board | `admin-missions` |
| Close / error | `admin-close`, `admin-error` |

## Automated test harnesses

Harnesses permitted to execute page JavaScript can use `window.casa.admin`:

```js
admin.getState(); // stage, elapsedMs, paused, catches, timers, uniform, power,
                  // hasPlayer, assisted, waitingForSwarm
admin.action('startRound1'); // also skip, resetStage, restart
admin.set('catches', false); // also timers, uniform, power, paused
admin.set('timers', false);
admin.set('missions', true); // show the hidden-by-default mission board
admin.show();
admin.hide();
```

Actions and setters return the current snapshot; invalid names or non-boolean
values throw. Browser agents restricted to UI actions must use the panel instead.
This is a local exhibition/debugging tool, not an authenticated security boundary.

## Professor / defense camera board

Open `/professor.html?game=<session-id>` alongside the game. Start round 1 and
verify mission advice, then use Skip stage through the result and defense briefing
to `round2a`. The same page must switch to Agent Views and add the lone attacker
when planning completes. Skip through `aiThink` into `round2b` and verify new
one tile per distinct AI route arrives with pop-in animations and reflows without scrolling.
The header distinguishes total agents from ways. Each tile follows one live agent
for that way and hands off to another survivor without adding a tile. After the last
agent finishes, retain the last view with the outcome. Hidden transit shows a status.
Pause to check that the views freeze with the world. Reset stage to clear old feeds;
restart or start round 1 to restore the Professor layout. Test with reduced motion
enabled to suppress animations. Reload the game afterward to restore defaults.
The development-only `/tools/agent-view-check.html` stress fixture uses 80 synthetic
actors across 20 ways; verify 20 views and at most four camera renders per frame.
Open `/tools/agent-view-check.html?overlap=1` for two agents sharing a position at
the current character scale. The feed should show the building and street with
no mask or hood covering the lens, even as the agents turn and animate.

## Defense planning regressions

At `aiThink`, check the full-screen parallel-agent handoff before the route reveal.
Its result must match the lone attacker: stopped, blocked, breached, or a neutral
line for an unfinished/skipped attempt. It holds for 7.5 seconds even if planning
finishes instantly. Pause or disable stage timers to inspect it; animations must
pause too. The final three-second countdown reports the actual ready agent count.
Check English/Hebrew, a compact window, and reduced motion. Reset stage should
restart the message and clear the countdown; admin Skip still waits for routes.

At the end of `round2b`, the **AI SWARM ENDED** popup must stay for 3.5 seconds
before results. A breached attacker still walking to the van keeps the round alive
until its exit finishes or the 60-second cap is reached. The timeout gets its own
explanation. During the popup, guards, attackers, score and defense commands freeze.
Pause and disabled timers hold the popup; reset/restart clears it. Check both languages.

At swarm launch, every route ribbon must begin at the same front plaza position.
Agents fan out toward all five entrances, including the supplier truck; none should
materialize at another entrance. Check that the truck bay has a clear aisle to its
inner door. Ordering a guard mid-round should replan agents from their current
positions. A hands-off observer must still see the full 60-second round and ending.

Test the transition after a first attacker breaches, and after locking a door in
its route until it is held. The AI should find routes through the remaining
defenses and the swarm should walk them. A prior power cut stays effective; a
live attacker with a card or uniform does not need to collect it again on replan.
Guards and the simulation clock hold during the AI planning/reveal screen, then
resume with the swarm. Skip during a pending search waits for actual routes.
An empty search is retried with more candidates; it must never open an empty
swarm stage. A genuine zero-route result is stated explicitly before results.

`tests/swarm-transition.spec.ts` replays both attacker outcomes on the real map.
`tests/planner-state.spec.ts`, `planner-worker.spec.ts` and `swarm-flow.spec.ts`
cover inventory, disabled defenses, slow preparation, failed searches and stage
resets. Reload the game after interactive checks to restore testing defaults.

## Guided walkthrough

Enabled by default for round 1. Use **Guided walkthrough** in either admin panel,
or `window.casa.admin.set("guided", false)`, to toggle it. This is a visual option
and does not mark a visit assisted. Reset stage resets the guide’s perimeter progress.
Test both sides, any early entrance, the vent power-first branch, the supplier’s
inner garage door, and the load/van loop. The guide observes inventory and progress;
it never unlocks doors, grants items, moves the player, or blocks another action.
Yellow rotating arrows mark destinations; the screen-edge arrow points toward an
offscreen destination. Objective floor rings have been removed.

Recon is one **Circle around the building** objective. Walk either direction from
the front and circle back around the building. Green floor chevrons follow the
chosen direction. Check both the trail and a closer walk beside the walls: progress
counts the surveyed perimeter rather than exact corner checkpoints. The HUD
percentage must advance and the mission must end on returning around to the front.
Soft light pulses flow in the direction of travel; pause freezes the animation,
and reduced-motion preferences keep the arrows steady.
Completing the circuit advances to entrance selection without requiring all five
discoveries. Entering early also removes the route. Check reset, guide off/on, and
stage skip to ensure no trail is left behind. The Professor uses the same advice.
Discovered entrances gain yellow arrows during recon alongside the green trail.
Approach the side door, vent, sewer and moving truck to verify each discovery;
unseen entrances must stay unmarked. The green trail clears when recon completes,
while the discovered entrance arrows remain. Visible objective arrows are solid yellow;
scenery-covered parts retain only an outer outline. During entry selection every
offscreen entrance has a small text-free edge marker. Edge markers do not pulse.

Vault entry has no printing interaction or waiting stage. Crossing into the vault
room completes access and points the guide at the drill wall immediately. The
development-only `/tools/vault-entry-check.html` fixture walks a card-carrying player
through the real vault door without Space, checks the resulting guide target, and
renders its arrow. The fixture supplies preparation items and removes guards;
it does not set `breached`. The planner also has no printing dwell time.


## Defense Live / SIEM board

Pair `/red-team.html` with the game. Use F3 to advance from round 1 through the
defense briefing, single attacker, AI planning, and swarm. The companion must
switch from red-team scenes to Security Operations automatically. Planning may
show ready agents but must have zero active intruders until they actually spawn.

In the single-agent round, verify one session and a quiet event stream. In the
swarm, verify all five entry rows and one matrix cell per spawned attacker. Queued
sessions must not count as active intruders. Press X, move a guard, and lock a door
in the game: each successful action must produce the corresponding log. A locked
door blocking an agent is not a catch or a breach. Power changes (including F3's
power checkbox) must update monitoring status immediately. Vault access and a
completed trip out with money must produce different incidents.

Pause the game and check the event total, log timestamps, and graph stop changing;
existing log rows must remain visible. At the normal ending popup, the board must
show the wave verdict and clear transient alerts. Reset stage to clear old logs.
Check English/Hebrew and 1280×720 / 1920×1080; the desktop matrix fits all agents,
while narrow windows can scroll. Reload the game afterward to restore defaults.


## Swarm route coverage

The in-game Ways in board shows one icon and name per entrance, with no route IDs
or tactic descriptions. Planning counts assigned attackers; live rows count incoming,
attacking, stopped, and vault-reaching attackers independently. Replans must not
double-count agents, and unfinished attempts must not turn into successful defenses.
Check the planning reveal, stage reset, and English/Hebrew layouts; only the entrance
list scrolls. `tests/entrance-board.spec.ts` covers the count and outcome rules.

During AI planning, the worker explores entrance/tactic combinations before timing
variations. A pool up to six times the visible agent count is searched within the
existing budget. Deployment prioritizes uncovered entrances, routes that can finish
within the round, actual tactics, and unused indoor paths. Repeated physical paths
only fill spare slots after distinct candidates are assigned. A slower route may
still represent an entrance when no faster route exists; it must not vanish from
the attack just because it cannot reach the vault before the cap.

At `round2b`, verify all reachable entrance names appear, including the supplier,
and the agent count stays within the configured capacity. All agents still start
at the front plaza. Move a guard while agents are outside: viable entrance
assignments should survive replanning. Seal a route and check that those agents can
choose another approach. `tests/swarm-coverage.spec.ts` checks physical-route
uniqueness, feasible tactics, coverage versus the previous launch policy, timed
simulation outcomes, and sealed-entry replans.

### Supplier truck

In the swarm, watch the supplier route: agents approach the shop, wait for the
loading stop, then ride with the actual truck. A mask/count badge follows its
passengers and disappears after unloading. The route ribbon follows the service
road. The SIEM shows waiting/riding statuses and real boarding/unloading incidents.
An agent entering the loading bay does not add a vault breach; it may wait there
for a new route and remains catchable. Check after the single-agent round too,
because that changes which delivery is available. A delayed agent must wait for
the next real loading stop instead of disappearing into an absent vehicle.
`tests/ai-truck.spec.ts` covers all shops, several planning start times, missed
boarding, truthful route previews, and the player's explicit boarding interaction.

### Mouse navigation

Start round 1 with catches and timers disabled. Click beyond a lobby counter and
watch the player walk around its end, then try the presses and loading-bay crates.
Clicks near prop edges should settle on nearby reachable ground. The player should
flow through corners, stop precisely, and switch immediately to keyboard movement.
Check the vent/sewer interactions after arrival, then reload to restore defaults.
`tests/player-navigation.spec.ts` also covers narrow doorways, U-shaped obstacles,
locked doors and mid-route closures, new wall openings, and unreachable clicks.
