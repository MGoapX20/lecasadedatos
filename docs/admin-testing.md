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

## Guided walkthrough

Enabled by default for round 1. Use **Guided walkthrough** in either admin panel,
or `window.casa.admin.set("guided", false)`, to toggle it. This is a visual option
and does not mark a visit assisted. Reset stage resets the guide’s perimeter progress.
Test both sides, any early entrance, the vent power-first branch, the supplier’s
inner garage door, and the load/van loop. The guide observes inventory and progress;
it never unlocks doors, grants items, moves the player, or blocks another action.
Yellow rotating arrows mark destinations; the screen-edge arrow points toward an
offscreen destination. Objective floor rings have been removed.

The guided perimeter order is right, then left. Visible arrows are solid yellow;
scenery-covered parts retain only an outer outline. During entry selection every
offscreen entrance has a small text-free edge marker. Edge markers do not pulse.

Vault entry has no printing interaction or waiting stage. Crossing into the vault
room completes access and points the guide at the drill wall immediately. The
development-only `/tools/vault-entry-check.html` fixture walks a card-carrying player
through the real vault door without Space, checks the resulting guide target, and
renders its arrow. The fixture supplies preparation items and removes guards;
it does not set `breached`. The planner also has no printing dwell time.
