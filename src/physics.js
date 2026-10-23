// Stable, facing-independent body volumes in source pixels. Weapons do not block movement.
export const BODY_BOXES = {
  player: { width: 30, height: 48 },
  boss: { width: 46, height: 82 },
};

export function getBodyBox(actor) {
  const body = actor.bodyBox ?? BODY_BOXES[actor.kind];
  const width = body.width * actor.scale, height = body.height * actor.scale;
  return {
    x: actor.x - width / 2,
    y: actor.groundY + actor.renderOffsetY * actor.scale - actor.elevation - height,
    width, height,
  };
}

export function moveHorizontally(actor, distance, blockers = []) {
  const body = getBodyBox(actor);
  let nextX = Math.max(64, Math.min(896, actor.x + distance));
  for (const blocker of blockers) {
    if (blocker === actor || blocker.ghostBrain?.intangible) continue;
    const obstacle = getBodyBox(blocker);
    if (body.y >= obstacle.y + obstacle.height || body.y + body.height <= obstacle.y) continue;
    // Clamp the whole movement path, so even a long update cannot cross a body.
    if (body.x + body.width <= obstacle.x) {
      nextX = Math.min(nextX, obstacle.x - body.width / 2);
    } else if (body.x >= obstacle.x + obstacle.width) {
      nextX = Math.max(nextX, obstacle.x + obstacle.width + body.width / 2);
    } else {
      // Recover an overlapping spawn/teleport by moving only this actor outward.
      nextX = actor.x <= blocker.x
        ? Math.min(nextX, obstacle.x - body.width / 2)
        : Math.max(nextX, obstacle.x + obstacle.width + body.width / 2);
    }
  }
  actor.x = Math.max(64, Math.min(896, nextX));
}

// The boss can push the player, but stops once the player reaches a stage edge.
export function moveBossHorizontally(boss, distance, player) {
  const body = getBodyBox(boss), other = getBodyBox(player);
  const separation = (body.width + other.width) / 2;
  let nextX = Math.max(64, Math.min(896, boss.x + distance));
  if (body.y < other.y + other.height && body.y + body.height > other.y) {
    if (distance > 0 && boss.x <= player.x && nextX + separation > player.x) {
      player.x = Math.min(896, Math.max(player.x, nextX + separation));
      nextX = Math.min(nextX, player.x - separation);
    } else if (distance < 0 && boss.x >= player.x && nextX - separation < player.x) {
      player.x = Math.max(64, Math.min(player.x, nextX - separation));
      nextX = Math.max(nextX, player.x + separation);
    }
  }
  boss.x = nextX;
}
