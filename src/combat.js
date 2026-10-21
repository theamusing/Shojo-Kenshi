import { getBodyBox } from './physics.js';

// Boxes use source pixels relative to the actor's feet, facing right.
// Body boxes exclude weapons; attack rectangles deliberately pad the blade.
export const HURTBOXES = {
  player: { x: -16, y: -48, width: 30, height: 48 },
  boss: { x: -24, y: -82, width: 46, height: 82 },
};
export const ATTACKBOXES = {
  5: { x: 0, y: -41, width: 34, height: 34 }, // source frame 6: (64,50)..(98,84)
  13: { x: 8, y: -35, width: 44, height: 16 }, // source frame 14: (72,56)..(116,72)
};
// The extra lower area catches the shorter player, including at body contact.
// Frame keys are zero-based: attack 1 => 13, attack 2 => 12/17, attack 3 => 11.
export const BOSS_ATTACKBOXES = {
  attack_1: { 12: { x: 8, y: -86, width: 112, height: 80 } },
  attack_2: {
    11: { x: 2, y: -63, width: 100, height: 57 },
    16: { x: 8, y: -88, width: 112, height: 82 },
  },
  attack_3: { 10: { x: 12, y: -88, width: 112, height: 82 } },
  jump_attack: { 12: { x: 2, y: -75, width: 124, height: 77 } },
};
export const HIT_FLASH_SECONDS = 1 / 16;
export const JUMP_KNOCKBACK_SPEED = 960;
export const BOSS_DAMAGE = { attack_1: 15, attack_2: 10, attack_3: 15, jump_attack: 30 };
const SWING_FRAMES = { attack: [4, 11], attack_1: [10], attack_2: [9, 14], attack_3: [8], jump_attack: [11] };

export function worldBox(actor, box) {
  return {
    x: Math.round(actor.x) + (actor.facing === 1 ? box.x : -box.x - box.width) * actor.scale,
    y: actor.groundY + (actor.renderOffsetY + box.y) * actor.scale - actor.elevation,
    width: box.width * actor.scale,
    height: box.height * actor.scale,
  };
}
export function getHurtbox(actor) { return worldBox(actor, HURTBOXES[actor.kind]); }
export function getAttackBox(actor, frame = actor.animator.frame) {
  if (actor.health <= 0) return null;
  if (actor.kind === 'boss') {
    const box = BOSS_ATTACKBOXES[actor.machine.current]?.[frame];
    return box ? worldBox(actor, box) : null;
  }
  if (actor.kind !== 'player' || actor.machine.current !== 'attack' || actor.attackRecoveryFrame !== null || !ATTACKBOXES[frame]) return null;
  return worldBox(actor, ATTACKBOXES[frame]);
}
export function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
export function resolveAttackHits(attacker, targets, frame = attacker.animator.frame, effects = null) {
  if (attacker.health <= 0 || attacker.previewing || attacker.animator.paused || (attacker.kind === 'player' && attacker.attackStage === null)) return;
  if (attacker.attackRecoveryFrame === null && SWING_FRAMES[attacker.machine.current]?.includes(frame)
    && !attacker.swingFrames.has(frame)) {
    attacker.swingFrames.add(frame);
    effects?.swing?.(attacker);
  }
  const box = getAttackBox(attacker, frame);
  if (!box) return;
  // Boss attack 2 has two independent strikes; each may hit/block once.
  let struck = attacker.hitTargets;
  if (attacker.kind === 'boss') {
    if (!attacker.strikeTargets.has(frame)) attacker.strikeTargets.set(frame, new Set());
    struck = attacker.strikeTargets.get(frame);
  }
  for (const target of targets) {
    if (target.health <= 0 || target === attacker || target.previewing || struck.has(target)) continue;
    if (overlaps(box, getHurtbox(target))) {
      struck.add(target);
      if (attacker.kind === 'boss' && target.kind === 'player') {
        const heavy = attacker.machine.current === 'jump_attack';
        if (target.isGuarding) {
          const postureGain = heavy ? 10 : 5;
          const breaksPosture = Number.isFinite(attacker.maxPosture) && attacker.posture + postureGain >= attacker.maxPosture;
          effects?.parry(target, heavy, breaksPosture);
          if (heavy) target.receiveGuardImpact(attacker, JUMP_KNOCKBACK_SPEED);
          else target.receiveGuardRecoil(attacker);
          effects?.posture?.(attacker, postureGain);
        } else {
          target.receiveHit(attacker, heavy ? JUMP_KNOCKBACK_SPEED : undefined);
          effects?.impact?.(attacker, target);
          effects?.damage?.(target, BOSS_DAMAGE[attacker.machine.current]);
        }
      } else {
        if (target.kind === 'boss' && target.machine.current === 'defend') {
          effects?.bossBlock?.(target);
        } else {
          target.flashRemaining = HIT_FLASH_SECONDS;
          effects?.impact?.(attacker, target);
        }
        effects?.damage?.(target, attacker.attackStage === 2 ? 20 : 15);
      }
    }
  }
}
export function drawHitboxes(ctx, actors) {
  ctx.save();
  ctx.lineWidth = 1;
  const draw = (box, stroke, fill) => {
    ctx.fillStyle = fill; ctx.strokeStyle = stroke;
    ctx.fillRect(box.x, box.y, box.width, box.height);
    ctx.strokeRect(box.x + .5, box.y + .5, box.width - 1, box.height - 1);
  };
  for (const actor of actors) draw(getHurtbox(actor), '#78d5ff', '#78d5ff18');
  ctx.setLineDash([4, 3]);
  for (const actor of actors) draw(getBodyBox(actor), '#e9ce80', '#e9ce8008');
  ctx.setLineDash([]);
  for (const actor of actors) {
    const box = getAttackBox(actor);
    if (box) draw(box, '#ff7969', '#ff796938');
  }
  ctx.restore();
}
