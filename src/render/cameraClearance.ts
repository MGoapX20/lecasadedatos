import type { CharacterBatch, CharacterPose } from './characters';
import { characterHeight } from './readability';

interface CameraActor { slot: number; pose: CharacterPose }

/** Plan followers can share a spawn or path position: don't film inside a peer's mask. */
export function withCameraClearance(
  batch: CharacterBatch,
  wearer: CameraActor,
  actors: Iterable<CameraActor>,
  render: () => void,
): void {
  const hidden = [wearer.slot];
  for (const actor of actors) {
    if (actor.slot < 0 || actor.slot === wearer.slot || !actor.pose.visible) continue;
    // A visual body radius, scaled with the model; ordinary nearby agents remain visible.
    const radius = characterHeight(actor.pose.scale) * .3;
    if (Math.hypot(actor.pose.x - wearer.pose.x, actor.pose.z - wearer.pose.z) < radius) hidden.push(actor.slot);
  }
  const hideNext = (index: number): void => {
    if (index === hidden.length) render();
    else batch.withHidden(hidden[index], () => hideNext(index + 1));
  };
  // Each batch restores its matrices in finally, including when rendering throws.
  hideNext(0);
}
