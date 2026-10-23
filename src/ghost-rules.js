// Active move set. Frame numbers are zero-based; unused sprite assets are retained.
const box = (width, y = -65, height = 62) => ({ x: 2, y, width, height });
export const GHOST_ATTACKS = {
  attack_1: { hits: { 14: 0 }, damage: 15, box: box(86), swings: [12] },
  attack_2: {
    hits: { 10: 0 }, damage: 15, box: box(68), swings: [8],
    knockbackSpeed: 220, guardRecoilSpeed: 110,
  },
  attack_3: { hits: { 7: 0 }, damage: 15, box: box(62), swings: [5],
    advance: { startFrame: 4, endFrame: 5, speed: 1000 } },
  attack_5: { hits: { 17: 0 }, damage: 22, box: box(85), swings: [15] },
  attack_7: { hits: { 14: 0, 24: 1 }, damage: 15, box: box(82), swings: [12, 22] },
  attack_9: { hits: { 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }, damage: 15,
    box: { x: -12, y: -44, width: 34, height: 22 }, swings: [3] },
  attack_10: { hits: { 14: 0, 23: 1 }, damage: 12, box: box(65), swings: [12, 21] },
};

export const GHOST_CONFIG = {
  speed: 54, nearDistance: 190,
  midDistance: 280, midShiftChance: .45,
  nearAttackChance: .92, farShiftChance: .60,
  recoveryMin: .5, recoveryMax: .9,
  parryPosture: 3, heavyParryPosture: 6,
  hitDodgeChance: .45, attackMotionScale: .85,
  dodgeDistance: 120, dodgeDuration: .5, recoveryWalkChance: .35,
  downSeconds: 2, thrustInitialSpeed: 420, thrustMaxSpeed: 1100, thrustAcceleration: 1600,
  hitShiftChance: .65, shiftCooldown: 3, shiftWait: 1, shiftAttackChance: .8,
};

export const GHOST_COMBOS = [
  ['attack_1'], ['attack_5'], ['attack_10'],
];

export const GHOST_ATTACK7_COMBO = ['attack_7', 'attack_2', 'attack_2', 'attack_1'];
export const GHOST_SHIFT_ATTACKS = ['attack_7', 'attack_1', 'attack_9'];

export function isHeavyAttack(actor) {
  return actor.machine?.current === 'jump_attack'
    || (actor.appearance === 'ghost' && actor.machine?.current === 'attack_1');
}

export function ghostStrikeId(actor, frame) {
  if (actor.machine.current === 'attack_9' && actor.ghostBrain?.thrustRecovering) return undefined;
  return GHOST_ATTACKS[actor.machine.current]?.hits[frame];
}
