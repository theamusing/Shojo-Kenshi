import { BossBrain } from './boss.js';
import { CombatEffects } from './effects.js';
import { moveHorizontally } from './physics.js';

export const DIFFICULTIES = {
  normal: { bossHealth: 600, posture: 60 },
  hard: { bossHealth: 1000, posture: 80 },
};
export const GHOST_DIFFICULTIES = {
  normal: { bossHealth: 600, posture: 60 },
  hard: { bossHealth: 800, posture: 80 },
};
export const ROUND_RULES = { playerHealth: 100, downSeconds: 3, defendDamageMultiplier: .3, introSeconds: 3, deathSpeed: .25 };
export const FINISHER = { duration: .65, speed: .2, fadeSeconds: .15 };

export class Duel {
  constructor(player, boss, { audio = null, introDuration = ROUND_RULES.introSeconds,
    difficulty = 'normal', hardUnlocked = false, onUnlock = () => {},
    brainClass = BossBrain, practice = false, unlockHard = true, ...options } = {}) {
    this.player = player; this.boss = boss; this.audio = audio;
    this.hardUnlocked = hardUnlocked === true;
    this.difficulty = difficulty === 'hard' && this.hardUnlocked ? 'hard' : 'normal';
    this.onUnlock = onUnlock;
    this.introDuration = introDuration;
    this.spawns = [player, boss].map(actor => ({ x: actor.x, facing: actor.facing }));
    this.practice = practice;
    this.unlockHard = unlockHard;
    this.brain = new brainClass(boss, player, options);
    this.effects = new CombatEffects(Math.random, audio);
    // Commit outcomes after animation updates, never inside their frame callbacks.
    this.events = [];
    this.effects.damage = (target, amount) => this.events.push({ type: 'damage', target, amount });
    this.effects.posture = (target, amount) => this.events.push({ type: 'posture', target, amount });
    this.targets = [boss];
    this.reset();
  }
  get canRestart() { return this.phase === 'dead' || this.phase === 'won'; }
  get downSeconds() { return this.brain.downSeconds ?? ROUND_RULES.downSeconds; }
  get noDamage() { return this.damageTaken === 0; }
  get finisherActive() { return this.phase === 'victory' && this.endTime < FINISHER.duration; }
  get finisherOpacity() { return this.finisherActive ? Math.min(1, (FINISHER.duration - this.endTime) / FINISHER.fadeSeconds) : 0; }
  setPaused(paused) { this.paused = paused; this.audio?.setPaused(paused); }
  reset(difficulty = this.difficulty) {
    if (!Object.hasOwn(DIFFICULTIES, difficulty) || (difficulty === 'hard' && !this.hardUnlocked)) return false;
    this.difficulty = difficulty;
    const rules = (this.boss.appearance === 'ghost' ? GHOST_DIFFICULTIES : DIFFICULTIES)[difficulty];
    [this.player, this.boss].forEach((actor, i) => {
      actor.x = this.spawns[i].x; actor.facing = this.spawns[i].facing; actor.resume();
      actor.maxHealth = i === 0 ? ROUND_RULES.playerHealth : rules.bossHealth;
      actor.health = actor.maxHealth;
    });
    this.boss.posture = 0;
    this.boss.maxPosture = rules.posture;
    this.newUnlock = false;
    this.phase = 'playing'; this.elapsed = 0; this.damageTaken = 0; this.endTime = 0;
    this.introRemaining = this.introDuration; this.downRemaining = 0;
    this.events.length = 0;
    this.brain.reset(); this.effects.clear(); this.setPaused(false);
    return true;
  }
  applyEvents() {
    // Movement previews retain sword feedback without entering unfinished combat states.
    if (this.practice) { this.events.length = 0; return; }
    for (const event of this.events.splice(0)) {
      if (this.phase !== 'playing') break;
      const { target, amount } = event;
      if (event.type === 'posture') {
        if (target !== this.boss || ['down', 'up', 'defeated'].includes(target.machine.current)) continue;
        target.posture = Math.min(target.maxPosture, target.posture + amount);
        if (target.posture === target.maxPosture) {
          target.machine.change('down', true);
          this.effects.postureBreak(target);
          this.brain.defensePending = false;
          this.brain.onStagger?.();
          this.downRemaining = this.downSeconds;
        }
      } else {
        const multiplier = target === this.boss && target.appearance !== 'ghost' && target.machine.current === 'defend' ? ROUND_RULES.defendDamageMultiplier : 1;
        const damage = Math.min(target.health, amount * multiplier);
        target.health = Math.max(0, target.health - damage);
        if (target === this.player) this.damageTaken += damage;
        if (target.health > 0) {
          if (target === this.boss && damage > 0) {
            if (this.introRemaining > 0 && this.brain.onOpeningHit?.()) this.introRemaining = 0;
            else if (this.introRemaining <= 0) this.brain.reactToHit();
          }
          continue;
        }
        this.endTime = 0;
        if (target === this.boss) {
          this.phase = 'victory'; target.machine.change('defeated', true);
        } else {
          this.phase = 'dying';
          if (target.machine.current !== 'hit') target.receiveHit(this.boss);
        }
      }
    }
  }
  updateBoss(dt) {
    const boss = this.boss;
    if (boss.machine.current === 'down') {
      boss.flashRemaining = Math.max(0, boss.flashRemaining - dt);
      const heldTime = boss.animator.finished ? dt : boss.animator.update(dt);
      if (boss.animator.finished) {
        this.downRemaining = Math.max(0, this.downRemaining - heldTime);
        boss.posture = boss.maxPosture * this.downRemaining / this.downSeconds;
        if (this.downRemaining <= 1e-9) { boss.posture = 0; boss.machine.change('up'); }
      }
    } else if (boss.machine.current === 'up') {
      boss.flashRemaining = Math.max(0, boss.flashRemaining - dt);
      boss.animator.update(dt);
      if (boss.animator.finished) this.brain.rest();
    } else if (this.introRemaining > 0) {
      this.brain.facePlayer();
      boss.machine.change('idle'); boss.animator.update(dt);
      boss.flashRemaining = Math.max(0, boss.flashRemaining - dt);
    } else this.brain.update(dt, this.effects);
  }
  updateEnding(dt) {
    const slowVictoryTime = this.phase === 'victory' ? Math.min(dt, Math.max(0, FINISHER.duration - this.endTime)) : 0;
    this.endTime += dt;
    if (this.phase === 'dying') {
      const slow = dt * ROUND_RULES.deathSpeed, player = this.player;
      const hitTime = Math.min(slow, player.knockbackRemaining);
      const decay = Math.exp(-8 * hitTime);
      moveHorizontally(player, player.knockbackVelocity * (1 - decay) / 8, this.targets);
      player.knockbackVelocity *= decay; player.knockbackRemaining -= hitTime;
      player.flashRemaining = Math.max(0, player.flashRemaining - slow);
      player.animator.update(slow); this.boss.animator.update(slow); this.effects.update(slow);
      if (player.animator.finished) this.phase = 'dead';
    } else if (this.phase === 'victory') {
      // Split at the cinematic boundary so large and small updates agree.
      const victoryTime = dt - slowVictoryTime + slowVictoryTime * FINISHER.speed;
      this.player.update(victoryTime, 0, [], [], null);
      this.boss.flashRemaining = Math.max(0, this.boss.flashRemaining - victoryTime);
      this.boss.animator.update(victoryTime); this.effects.update(victoryTime);
      if (this.boss.animator.finished) {
        this.phase = 'won';
        if (!this.hardUnlocked && this.unlockHard) {
          this.hardUnlocked = true; this.newUnlock = true; this.onUnlock(this);
        }
      }
    }
  }
  update(dt, direction = 0, actions = []) {
    if (this.paused || this.canRestart) return;
    if (this.phase !== 'playing') { this.updateEnding(dt); return; }
    this.player.update(0, direction, actions, this.targets, this.effects);
    this.applyEvents();
    let remaining = dt;
    while (remaining > 1e-9) {
      if (this.phase !== 'playing') { this.updateEnding(remaining); break; }
      const slice = Math.min(remaining, 1 / 120, this.introRemaining > 0 ? this.introRemaining : Infinity);
      this.elapsed += slice;
      this.effects.update(slice);
      this.player.update(slice, direction, [], this.targets, this.effects);
      this.applyEvents();
      if (this.phase === 'playing') { this.updateBoss(slice); this.applyEvents(); }
      const wasIntro = this.introRemaining > 0;
      this.introRemaining = Math.max(0, this.introRemaining - slice);
      if (wasIntro && this.introRemaining <= 1e-9) {
        this.introRemaining = 0;
        if (this.phase === 'playing') this.brain.onIntroEnd?.();
      }
      remaining -= slice;
    }
  }
}
