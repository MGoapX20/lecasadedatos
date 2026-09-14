import type { ThiefSnapshot } from '../companion/protocol';

/** Priority matters: the interaction in progress takes precedence over travel advice. */
export function adviceKey(s: ThiefSnapshot): string {
  if (s.exfil.complete) return 'complete';
  if (s.player?.respawning) return 'respawn';
  if (s.interaction) return s.interaction.kind;
  if (s.player?.hidden) return 'transit';
  if (s.professor?.guide) return s.professor.guide;
  if (s.player?.breached) return !s.exfil.hole ? 'wall' : s.player.carrying ? 'van' : 'load';
  return s.phase === 'recon' ? 'right' : s.phase === 'foothold' ? 'entry' : 'prepare';
}

export const advice: Record<string, [string, string, string]> = {
  right: ['Explore the right side', 'Walk around the right side of the base and look for possible entrances. Get close to investigate them.', 'Use the arrow keys or WASD to move. Q / E rotates your view.'],
  left: ['Continue around the left side', 'Complete your survey on the other side. Reconnaissance reveals alternatives before you commit to one.', 'Get close to an entrance to discover it.'],
  entry: ['Choose your way inside', 'Any discovered entrance can work. Pick an approach you want to try; you do not need to enter through all five.', 'Follow an entrance arrow, or use the live map to orient yourself.'],
  prepare: ['Get the uniform and cut the power', 'These two preparations can be done in either order. The uniform reduces guard recognition; cutting power disables the cameras.', 'Walk over the uniform. At the fuse box, cut the two live wires.'],
  uniform: ['Put on the staff uniform', 'Collect the uniform to blend in. Keep your distance from guards: a disguise is less effective at close range and during an alarm.', 'Walk over the uniform to equip it.'],
  fuse: ['Disable the cameras', 'Go to the fuse box and cut the two wires carrying a moving spark. This keeps the cameras offline for the round.', 'Up / down selects a wire. Space cuts it.'],
  card: ['Collect the access card', 'Find the manager’s card. The vault door requires this credential and cannot be lockpicked.', 'Walk over the card to collect it.'],
  vault: ['Enter the vault', 'Use the card to cross the vault doorway. Entry completes automatically; the next step is opening a way out.', 'Walk through the vault door with the access card.'],
  garage: ['Unlock the garage’s inner door', 'You made it inside with the supplier. Open the inner garage door before preparing your uniform and power options.', 'Approach the locked inner door to pick it.'],
  ride: ['Stay aboard the supplier’s truck', 'Wait for the truck to return to the loading bay. You will be dropped off inside when it unloads.', 'Space exits only while the truck is stopped.'],
  truck: ['Ride into the base', 'The supplier’s route provides your access. Wait for the truck to unload inside the garage.', 'Stay aboard until you reach the loading bay.'],
  lockpick: ['Time your lockpick', 'Press Space when the moving marker enters the target zone. A miss attracts attention, so watch the rhythm.', 'Press Space when the marker enters the target zone.'],
  wire: ['Cut the live wires', 'Look for the travelling sparks. Cut both live wires; avoid the earth wires, which cause a short and noise.', 'Choose the sparking wires with ↑ / ↓. Space cuts. Move sideways to leave.'],
  drill: ['Drill in short bursts', 'Make progress without overheating the drill. Release before it jams, then continue when it has cooled.', 'Hold Space to drill. Release Space to cool down.'],
  wall: ['Open an extraction route', 'Head to the marked vault wall. Drill through it to open a route for the documents and the escape van.', 'Hold Space at the wall, releasing regularly to manage heat.'],
  load: ['Collect TOP SECRET documents', 'Take a document bundle from a uranium station, then deliver it to the escape van. Repeat until all required bundles are out.', 'Stand beside a document station and press Space.'],
  van: ['Deliver your document bundle', 'Carry the files to the escape van. If it is still approaching, wait for it to park before unloading.', 'Press Space beside the parked van to deliver.'],
  transit: ['Follow the passage through', 'You are travelling through an entrance. Wait for the passage animation to finish before moving on.', 'You will emerge automatically.'],
  respawn: ['Regroup and try another approach', 'You were caught. Wait to return, then use what you discovered to adjust your route. Delivered documents stay delivered.', 'Keep away from guard sightlines when you return.'],
  complete: ['The documents are out', 'You completed the extraction. The result screen will compare your attempt with the AI’s approach.', 'Follow the game’s result-screen prompt.'],
};
