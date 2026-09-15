[X] Make the green highlight better

[X] Add an admin panel to skip/reset stages, toggling the catches and timers. And activating/deactivating the uniform and power states. 	Also, add to the testing the ability to use it for the AGENT.
	- The panel should also have all of the game's urls listed.

[X] Fix camera works again after breaking the wall. Not in functionality, but in the animations and movement.

[X] Remove the missions bar, and create a toggle to add it back via the admin panel.

[X] Indicative arrows for where to go, what to do.
	- Add a guided walkthrough to the game, starting with the first stage of the red team.
	- The flow is described in the image file 'RedTeamFlow.png'.
	- The indication to where to go should be by a spinning yellow arrow pointing down, and if it is out of view, 
	by a 2D indicator at the side of the screen.
	- The previous circle on the floor highlights are no longer necessary.
	- This mode should be the default when starting the game.
	- The walkthrough should indicate but not enforce actions (just like the missions bar didn't enforce).

[X] Fix the waiting bar for the roof/air vent and the sewer. For both make a small animation for the bar to indicate going through the vent (square bar) or through the sewer (circular bar).

[X] Increase the walking space at the start of the map (the pavement near the entrance).

[X] Remove the stand/shop from behind the bank. 

[X] Add to the start screen a banner that indicates that the game was developed by an AI (both claude and GPT).

[X] Add a top-down mini-map, currently accessible through a different url. The map should present the entire map from a static position, and be accurate to the current state of the map. Only the pavement and bank areas matter, and decorations that do not have significance and/or do not block the way are not to be shown.

[X] Change the theme to be more like a nuclear base.
	- change the money to TOP SECRET documents.
	- change the trees into nuclear missile heads.
	- change the gold presses into uranium
	- remove the gold bars from the vault.
	- Change the burger stands to an atomic symbol.
	- Add banners to the vault's wall, when the player attacks it should have the Iranian flag, and when defending it should have Israel's flag.
	- Break the task into subtasks, and initiate agents if possible.

[X] Make the guards' movement circular, instead of them teleporting back to the start of their route. (make them walk back the way they came, or in a circle when more appropriate).

[X] Add an irenian/arab agent to indicate the current action.

[X] In the defending mode/stage, make it such that when clicking a location the nearest guard (calculated by pathfinding to the location) will automatically go there, Instead of needing to click on a specific guard.

[X] Add a set of indicators of actions for the defensive scenario, for example hint on locking doors (like the floating yellow arrow - at the attacking phase) - but something for guard-like. also change the cursor to something that will make the user understand that he is in the guard mode that can move guards by clicking the ground. - in short, make a UI/UX overhaul in the defendding side

[X] In the defending mode/stage, make it such that when clicking a location the nearest guard (calculated by pathfinding to the location). 	Instead of needing to click on a specific guard.

[X] Make the AI agents attack all the different paths, but they all should start from the same initial position (for example the front doors outside)

[X] In the defense stage, change the red-team live layout into a defending live layout - a SIEM control room or some like that with overwheling logs and alerts popping up - the player should feel really nervous when the ai swarm attacks him against the single AI where he can defend - make sure that its behaving according to whats happeneing in the game.
 
[X] Replace the "Datos" part from game name with "Uranio"

[X] When ai swarm planning, make sure to maximize on coverage so they will try and cover every way in possible instead of following other's routes

[X] Improve the path finding when using mouse to move to go around obstacles.

[X] Improve layout for "ways in" board - remove the seconday text, make it more simplified and understandable.

[ ] Add some more "nuclear" cosmetics around the map, like centrifuges in some rooms etc...

[ ] Change the different music from the GAP board at the end, it should continue with the same music, just higher - just like the homepage logic.

[X] Make player faster.

[X] Fix no ways in glitch, sometimes when the attacker manages to pass through or when the attacker is locked behind a door, the ai cant seems to find any ways in...

[X] There is a problem with the circle around the building, it never ends, also yellow arrows of discovered stuff doesnt popup while walking near them...

[X] The red-team layout board is too overwhelming, make it use the entire screen dynamically, and remove all unecessary text, simplify the board, keep the site and the endpoints (etc..) while making anything else minimal.

[X] At the AI Swarm phase, the game ends too quickly, there should me a popup message for a couple of seconds indicating the swarm ended, its like the defend phsae of the ai swarm ends in the middle...
 
[X] The best chiefs leaderboard on the bottom shows duplicate.

[X] The agent's camera shows the mask when recording the live feed.

[X] Add the transition from one attacker to AI attackers more noticeable. Adding a message and maybe more. (something like - good job on 1 agent, but we live in a world of Parallel multi agent systems)

[X] Make everything bigger (especially the characters) - while maintaing the same large overview.

[X] Make the clickable radius of doors a lot smaller and more precise on the door itself - its easy to missclick it.

[X] In the first "recon" phase lets change the mission to Circle around the building... with a subtle green arrows on the actual floor indicating the route it should take.
