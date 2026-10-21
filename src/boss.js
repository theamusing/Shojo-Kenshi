import { moveBossHorizontally } from './physics.js';
import { resolveAttackHits } from './combat.js';

export const BOSS_CONFIG = {
  speed: 96,
  attackDistance: 210,
  minimumDecisionTime: 0.5,
  decisionTimeVariation: 0.35,
  farMoveChance: 0.8,
  nearAttackChance: 0.62,
  nearMoveChance: 0.23,
  defendOnHitChance: 0.28,
  minimumDefendTime: 0.5,
  defendTimeVariation: 0.4,
  lowHealthThreshold: 0.5,
  lowHealthAttackBonus: 0.16,
  lowHealthJumpChance: 0.18,
  lowHealthThrustJumpChance: 0.45,
  leftThirdX: 320,
  leftThirdRetreatChance: 0.95,
  leftEdgeRetreatChance: 0.98,
  closeRetreatDistance: 180,
  rightCloseRetreatChance: 0.55,
  leftCloseRetreatChance: 0.60,
  farJumpChance: 0.10,
  thrustJumpChance: 0.30,
  jumpMaxDistance: 520,
  jumpSpeed: 360,
  jumpStopDistance: 120,
};

export function leftPressure(x) { return Math.max(0, Math.min(1, (480 - x) / (480 - 140))); }

export class BossBrain {
  constructor(boss, player, { random = Math.random, ...config } = {}) {
    this.boss = boss; this.player = player; this.random = random;
    this.config = { ...BOSS_CONFIG, ...config };
    this.boss.speed = this.config.speed;
    this.reset();
  }
  reset() {
    this.decisionRemaining = this.config.minimumDecisionTime;
    this.moveMode = 'approach';
    this.lastAttack = null;
    this.defensePending = false;
    this.defendRemaining = 0;
  }
  facePlayer() {
    this.boss.facing = Math.sign(this.player.x - this.boss.x) || this.boss.facing;
  }
  get lowHealth() { return this.boss.health > 0 && this.boss.health / this.boss.maxHealth <= this.config.lowHealthThreshold; }
  reactToHit() {
    const boss = this.boss;
    if (boss.health <= 0 || boss.previewing || boss.animator.paused
      || ['defend', 'down', 'up', 'defeated'].includes(boss.machine.current) || this.defensePending) return;
    if (this.random() >= this.config.defendOnHitChance) return;
    if (boss.canMove) this.startDefense();
    else this.defensePending = true; // Finish the committed attack before raising the guard.
  }
  startDefense() {
    this.facePlayer();
    this.defensePending = false;
    this.boss.machine.change('defend', true);
    // Roll once on entry. Short guards exit early; long guards hold the last pose.
    this.defendRemaining = this.config.minimumDefendTime + this.random() * this.config.defendTimeVariation;
  }
  startRandomAttack() {
    const attacks = ['attack_1', 'attack_2', 'attack_3'];
    const weights = attacks.map(name => name === this.lastAttack ? 0.65 : 1);
    let choice = this.random() * weights.reduce((a, b) => a + b, 0);
    let name = attacks[2];
    for (let i = 0; i < attacks.length; i++) {
      choice -= weights[i];
      if (choice < 0) { name = attacks[i]; break; }
    }
    this.startAttack(name);
  }
  startAttack(name) {
    this.facePlayer();
    this.lastAttack = name;
    this.boss.machine.change(name, true);
    this.decisionRemaining = 0;
  }
  rest() {
    this.facePlayer();
    this.boss.machine.change('idle');
    this.decisionRemaining = this.config.minimumDecisionTime + this.random() * this.config.decisionTimeVariation;
  }
  decide() {
    const boss = this.boss, config = this.config;
    if (this.defensePending) { this.startDefense(); return; }
    this.facePlayer();
    const distance = Math.abs(boss.x - this.player.x);
    const near = distance <= config.attackDistance;
    const pressure = this.player.x < boss.x ? leftPressure(boss.x) : 0;
    const baseAttackChance = near ? config.nearAttackChance - pressure * 0.25 : 0;
    const attackChance = near ? Math.min(.95, baseAttackChance + (this.lowHealth ? config.lowHealthAttackBonus : 0)) : 0;
    // Scale both non-attack choices together, preserving retreat behavior and a chance to rest.
    const moveChance = near ? (config.nearMoveChance + pressure * 0.30) * (1 - attackChance) / (1 - baseAttackChance) : config.farMoveChance;
    const jumpChance = this.lowHealth ? config.lowHealthJumpChance : config.farJumpChance;
    const roll = this.random();
    if (!near && distance <= config.jumpMaxDistance && this.lastAttack !== 'jump_attack' && roll < jumpChance) {
      this.startAttack('jump_attack');
      return;
    }
    if (roll < attackChance) {
      this.startRandomAttack();
      return;
    }
    if (roll < attackChance + moveChance) {
      // Pick attack/idle/move first. Proximity changes movement direction only,
      // so a stationary player at the left wall can still be approached and attacked.
      const closeRetreatChance = distance <= config.closeRetreatDistance
        ? (boss.x < 480 ? config.leftCloseRetreatChance : config.rightCloseRetreatChance)
        : 0;
      // Avoid pressing a player farther into the left corner. Ramp up before
      // the left third, then leave only a 5%–2% chance to walk toward the wall.
      // A player to our right must still be approachable away from that wall.
      const wallRetreatChance = this.player.x < boss.x
        ? (boss.x > config.leftThirdX
          ? config.leftThirdRetreatChance * Math.max(0, (480 - boss.x) / (480 - config.leftThirdX))
          : config.leftThirdRetreatChance + (config.leftEdgeRetreatChance - config.leftThirdRetreatChance)
            * Math.max(0, Math.min(1, (config.leftThirdX - boss.x) / (config.leftThirdX - 140))))
        : 0;
      const retreatChance = Math.max(closeRetreatChance, wallRetreatChance);
      this.moveMode = this.random() < retreatChance ? 'retreat' : 'approach';
      boss.machine.change('run');
    } else boss.machine.change('idle');
    this.decisionRemaining = config.minimumDecisionTime + this.random() * config.decisionTimeVariation;
  }
  update(dt, effects = null) {
    const boss = this.boss, player = this.player;
    boss.flashRemaining = Math.max(0, boss.flashRemaining - dt);
    if (boss.previewing) { boss.animator.update(dt); return; }
    // Inspection/paused animation must not turn into a live attack behind the debug panel.
    if (boss.animator.paused || player.previewing || player.animator.paused) return;
    // Duel owns knockdown recovery and victory transitions.
    if (['down', 'up', 'defeated'].includes(boss.machine.current)) { boss.animator.update(dt); return; }
    let remaining = dt;
    do {
      if (boss.machine.current === 'defend') {
        const slice = Math.min(remaining, this.defendRemaining);
        boss.animator.update(slice);
        this.defendRemaining = Math.max(0, this.defendRemaining - slice);
        remaining = Math.max(0, remaining - slice);
        if (this.defendRemaining <= 1e-9) this.startRandomAttack();
        continue;
      }
      if (boss.canMove) {
        this.facePlayer();
        if (this.decisionRemaining <= 1e-9) this.decide();
        if (boss.machine.current === 'defend') continue;
        if (boss.canMove) {
          const slice = Math.min(remaining, this.decisionRemaining);
          if (boss.machine.current === 'run') {
            const direction = this.moveMode === 'retreat' ? -boss.facing : Math.sign(player.x - boss.x);
            moveBossHorizontally(boss, direction * boss.speed * slice, player);
          }
          boss.animator.update(slice);
          this.decisionRemaining = Math.max(0, this.decisionRemaining - slice);
          remaining = Math.max(0, remaining - slice);
          continue;
        }
      }
      // Attacks lock facing and play to completion; AI cannot cancel their windup.
      // Split at frame boundaries so jump travel finishes before frame 13's hit,
      // even when a single update spans the entire jump.
      const slice = Math.min(remaining, Math.max(0, 1 / boss.animator.fps - boss.animator.elapsed));
      if (boss.machine.current === 'jump_attack' && boss.animator.frame >= 3 && boss.animator.frame <= 11) {
        const gap = (player.x - boss.x) * boss.facing;
        const travel = Math.min(this.config.jumpSpeed * slice, Math.max(0, gap - this.config.jumpStopDistance));
        moveBossHorizontally(boss, boss.facing * travel, player);
      }
      resolveAttackHits(boss, [player], boss.animator.frame, effects);
      boss.animator.update(slice, frame => resolveAttackHits(boss, [player], frame, effects));
      remaining = Math.max(0, remaining - slice);
      if (boss.machine.current === 'defeated') break;
      if (!boss.animator.finished) continue;
      if (boss.machine.current === 'jump_attack') {
        this.lastAttack = 'jump_attack';
        this.rest(); // A full idle decision is mandatory after every jump slash.
      } else if (this.defensePending) {
        this.startDefense();
      } else if (boss.machine.current === 'attack_3'
        && Math.abs(player.x - boss.x) <= this.config.jumpMaxDistance
        && this.random() < (this.lowHealth ? this.config.lowHealthThrustJumpChance : this.config.thrustJumpChance)) {
        this.startAttack('jump_attack');
      } else this.decide();
    } while (remaining > 1e-9);
  }
}
