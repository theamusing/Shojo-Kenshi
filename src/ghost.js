import { moveHorizontally, moveBossHorizontally } from './physics.js';
import { resolveAttackHits } from './combat.js';
import { GHOST_ATTACKS, GHOST_COMBOS, GHOST_ATTACK7_COMBO, GHOST_SHIFT_ATTACKS, GHOST_CONFIG } from './ghost-rules.js';
export { GHOST_CONFIG } from './ghost-rules.js';

export class GhostBrain {
  constructor(boss, player, { random = Math.random } = {}) {
    this.boss = boss; this.player = player; this.random = random;
    boss.speed = GHOST_CONFIG.speed; boss.ghostBrain = this;
    this.reset();
  }
  reset() {
    this.decisionRemaining = .4; this.moveMode = 'approach';
    this.recovering = false; this.heavyAttack = false;
    this.trailRemaining = 0;
    this.dodgeOriginX = this.boss.x;
    this.combo = []; this.comboIndex = 0; this.rootOffset = 0;
    this.comboFromShift = false;
    this.lastAttack = null;
    this.shiftCooldown = 0; this.shiftPhase = null; this.shiftRemaining = 0;
    this.shiftPending = false; this.openingShiftDone = false;
    this.shiftAttackOnArrival = false;
    this.thrustRecovering = false;
    this.thrustElapsed = 0;
    this.shiftMistStarted = false; this.reason = 'opening';
  }
  facePlayer() { this.boss.facing = Math.sign(this.player.x - this.boss.x) || this.boss.facing; }
  get distance() { return Math.abs(this.player.x - this.boss.x); }
  get downSeconds() { return GHOST_CONFIG.downSeconds; }
  get isDodging() { return this.boss.machine.current === 'float'; }
  get dodgeProgress() {
    if (!this.isDodging) return 0;
    const animator = this.boss.animator;
    const time = (animator.frame - 2) / animator.fps + animator.elapsed;
    return Math.max(0, Math.min(1, time / GHOST_CONFIG.dodgeDuration));
  }
  get invulnerable() {
    if (this.isDodging) return true;
    const f = this.boss.animator.frame;
    return this.boss.machine.current === 'shift'
      && (this.shiftPhase === 'hidden' || (f >= 4 && f <= 15));
  }
  get intangible() { return !this.isDodging && this.boss.machine.current === 'shift' && this.invulnerable; }
  get opacity() {
    if (this.isDodging) {
      const distance = Math.min(1, Math.abs(this.boss.x - this.dodgeOriginX) / GHOST_CONFIG.dodgeDistance);
      return .85 - .65 * distance;
    }
    if (this.boss.machine.current !== 'shift') return 1;
    if (this.shiftPhase === 'hidden') return 0;
    const frame = this.boss.animator.frame + this.boss.animator.elapsed * 12;
    return frame < 10 ? Math.max(0, Math.min(1, 1 - (frame - 4) / 6))
      : Math.max(0, Math.min(1, (frame - 10) / 6));
  }
  startAction(name, keepCombo = false) {
    this.recovering = false; this.heavyAttack = false;
    this.shiftAttackOnArrival = false;
    this.thrustRecovering = false;
    this.thrustElapsed = 0;
    this.trailRemaining = 0;
    this.facePlayer();
    if (!keepCombo) { this.combo = []; this.comboIndex = 0; this.comboFromShift = false; }
    this.rootOffset = 0; this.shiftPhase = null; this.shiftMistStarted = false;
    this.boss.machine.change(name, true);
    this.decisionRemaining = 0;
  }
  startAttack(name, keepCombo = false, { fromShift = false } = {}) {
    if (!GHOST_ATTACKS[name]) throw new Error(`Inactive ghost attack: ${name}`);
    if (!keepCombo && name === 'attack_7') {
      this.combo = [...GHOST_ATTACK7_COMBO];
      this.comboFromShift = fromShift;
      this.comboIndex = 0; keepCombo = true;
      this.reason = fromShift ? 'shiftAttack' : 'approachAttack';
    }
    const inCombo = keepCombo && this.combo.length > 1;
    if (inCombo && this.comboIndex > 0) this.reason = 'combo';
    let startFrame = 0, endFrame = this.boss.animator.clips[name].frames - 1;
    if (name === 'attack_1') startFrame = inCombo ? 7 : fromShift ? 4 : 0;
    if (name === 'attack_7' && fromShift) startFrame = 4;
    if (name === 'attack_3') this.reason = 'dodgeCounter';
    if (name === 'attack_9') endFrame = 9;
    if (inCombo && name === 'attack_2') {
      endFrame = 11;
      startFrame = 5;
      if (this.combo[this.comboIndex - 1] === 'attack_2') startFrame = 7;
    }
    if (!keepCombo) this.reason = fromShift ? 'shiftAttack' : 'single';
    this.startAction(name, keepCombo);
    this.lastAttack = name;
    this.heavyAttack = name === 'attack_1';
    this.boss.animator.play(name, { restart: true, startFrame, endFrame });
    // Skipped windup frames must not teleport the body or replay their travel.
    this.rootOffset = this.boss.animator.clip.rootXs?.[startFrame] ?? 0;
  }
  startCombo() {
    const choices = GHOST_COMBOS.filter(combo => this.lastAttack !== 'attack_1' || combo[0] !== 'attack_1');
    const index = Math.min(choices.length - 1, Math.floor(this.random() * choices.length));
    this.combo = [...choices[index]]; this.comboIndex = 0;
    this.comboFromShift = false;
    this.reason = this.combo.length > 1 ? 'combo' : 'single';
    this.startAttack(this.combo[0], true);
  }
  startDodge() {
    this.startAction('float'); this.shiftPhase = 'dodge';
    this.dodgeOriginX = this.boss.x;
    this.combo = ['float', 'attack_3']; this.comboIndex = 0;
    this.reason = 'dodge'; this.boss.flashRemaining = 0;
    this.boss.animator.play('float', { restart: true, startFrame: 2, endFrame: 7 });
  }
  startShift({ attackOnArrival = false } = {}) {
    this.shiftPending = false;
    this.reason = 'teleport'; this.startAction('shift'); this.shiftPhase = 'vanish';
    this.shiftAttackOnArrival = attackOnArrival;
    this.shiftCooldown = GHOST_CONFIG.shiftCooldown;
    this.boss.animator.play('shift', { restart: true, endFrame: 9 });
  }
  requestShift() {
    if (this.boss.health <= 0 || this.boss.machine.current === 'shift') return;
    if (GHOST_ATTACKS[this.boss.machine.current]
      || ['float', 'down', 'up'].includes(this.boss.machine.current)) this.shiftPending = true;
    else this.startShift();
  }
  onIntroEnd() {
    if (this.openingShiftDone || this.boss.health <= 0) return;
    this.openingShiftDone = true;
    this.requestShift();
  }
  onOpeningHit() { this.onIntroEnd(); return true; }
  onStagger() { this.shiftPending = false; this.shiftAttackOnArrival = false; this.comboFromShift = false; this.heavyAttack = false; }
  reactToHit() {
    if (this.boss.health > 0 && this.boss.machine.current === 'up') {
      this.shiftPending = false; this.startDodge(); return;
    }
    if (this.boss.health <= 0 || this.shiftPending
      || ['float', 'shift', 'down', 'up', 'defeated'].includes(this.boss.machine.current)) return;
    if (this.boss.canMove && this.random() < GHOST_CONFIG.hitDodgeChance) {
      this.startDodge(); return;
    }
    if (this.shiftCooldown > 0) return;
    if (this.random() < GHOST_CONFIG.hitShiftChance) this.requestShift();
  }
  rest() {
    if (this.shiftPending) { this.startShift(); return; }
    this.facePlayer(); this.combo = []; this.comboIndex = 0;
    this.comboFromShift = false;
    this.shiftAttackOnArrival = false;
    this.rootOffset = 0; this.shiftPhase = null;
    this.recovering = true; this.heavyAttack = false;
    const roam = this.random() < GHOST_CONFIG.recoveryWalkChance;
    this.moveMode = roam && this.random() < .55 ? 'retreat' : 'approach';
    this.boss.machine.change(roam ? 'run' : 'idle');
    this.decisionRemaining = GHOST_CONFIG.recoveryMin
      + this.random() * (GHOST_CONFIG.recoveryMax - GHOST_CONFIG.recoveryMin);
    this.reason = 'recover';
  }
  decide() {
    this.recovering = false;
    this.facePlayer();
    const near = this.distance <= GHOST_CONFIG.nearDistance;
    const mid = !near && this.distance <= GHOST_CONFIG.midDistance, roll = this.random();
    if (near) {
      if (roll >= GHOST_CONFIG.nearAttackChance && this.shiftCooldown <= 0) this.startShift();
      else this.startCombo();
      return;
    }
    const shift = roll < (mid ? GHOST_CONFIG.midShiftChance : GHOST_CONFIG.farShiftChance);
    if (this.shiftCooldown <= 0 && shift) { this.startShift({ attackOnArrival: true }); return; }
    this.moveMode = 'approach';
    this.boss.machine.change(roll < .96 ? 'run' : 'idle');
    this.decisionRemaining = .35 + this.random() * .3; this.reason = 'roam';
  }
  finishAction() {
    if (this.comboIndex + 1 < this.combo.length) {
      this.comboIndex++; this.startAttack(this.combo[this.comboIndex], true);
    } else this.rest();
  }
  teleport(effects) {
    const boss = this.boss, player = this.player;
    const attack = this.shiftAttackOnArrival || this.random() < GHOST_CONFIG.shiftAttackChance;
    this.shiftAttackOnArrival = false;
    const side = 896 - player.x >= player.x - 64 ? 1 : -1;
    const available = side > 0 ? 896 - player.x : player.x - 64;
    const max = Math.min(attack ? 220 : 420, available - 20), min = Math.min(attack ? 140 : 320, max);
    boss.x = player.x + side * (min + this.random() * (max - min));
    this.facePlayer();
    if (attack) {
      const choices = GHOST_SHIFT_ATTACKS.filter(name => this.lastAttack !== 'attack_1' || name !== 'attack_1');
      const index = Math.min(choices.length - 1, Math.floor(this.random() * choices.length));
      const name = choices[index];
      if (name === 'attack_9') boss.x = side > 0 ? 896 : 64;
      this.startAttack(name, false, { fromShift: true });
    }
    else {
      this.combo = []; this.comboIndex = 0; this.comboFromShift = false; this.heavyAttack = false;
      this.shiftPhase = 'appear';
      boss.animator.play('shift', { restart: true, startFrame: 10 });
    }
    effects?.ghostMist?.(boss, true);
  }
  applyRootMotion(frame) {
    const boss = this.boss, offsets = boss.animator.clip.rootXs;
    if (!offsets) return;
    const offset = offsets[frame];
    moveBossHorizontally(boss, (offset - this.rootOffset) * boss.scale * boss.facing * GHOST_CONFIG.attackMotionScale, this.player);
    this.rootOffset = offset;
  }
  finishThrust() {
    this.thrustRecovering = true; this.reason = 'thrustRecovery';
    this.boss.animator.play('attack_9', { restart: true, startFrame: 10 });
  }
  advanceThrust(dt) {
    const { thrustInitialSpeed: initial, thrustMaxSpeed: max, thrustAcceleration: acceleration } = GHOST_CONFIG;
    const speed = Math.min(max, initial + acceleration * this.thrustElapsed);
    const accelerating = Math.min(dt, Math.max(0, (max - speed) / acceleration));
    const distance = speed * accelerating + .5 * acceleration * accelerating ** 2 + max * (dt - accelerating);
    this.thrustElapsed += dt;
    moveHorizontally(this.boss, this.boss.facing * distance, [this.player]);
  }
  update(dt, effects = null) {
    const boss = this.boss, animator = boss.animator;
    if (animator.paused || this.player.previewing || ['down', 'up', 'defeated'].includes(boss.machine.current)) return;
    boss.flashRemaining = Math.max(0, boss.flashRemaining - dt);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);
    let remaining = dt;
    while (remaining > 1e-9) {
      const state = boss.machine.current;
      if (boss.canMove) {
        this.facePlayer();
        if ((!this.recovering && this.distance <= GHOST_CONFIG.nearDistance)
          || this.decisionRemaining <= 1e-9) { this.decide(); continue; }
        const slice = Math.min(remaining, this.decisionRemaining, 1 / 120);
        if (state === 'run') {
          const before = boss.x, direction = boss.facing * (this.moveMode === 'retreat' ? -1 : 1);
          moveHorizontally(boss, direction * boss.speed * slice, [this.player]);
          if (Math.abs(boss.x - before) < .001) boss.machine.change('idle');
        }
        animator.update(slice); this.decisionRemaining -= slice; remaining -= slice;
        if (!this.recovering && this.distance <= GHOST_CONFIG.nearDistance) this.decide();
        continue;
      }
      if (state === 'shift' && this.shiftPhase === 'hidden') {
        const slice = Math.min(remaining, this.shiftRemaining);
        this.shiftRemaining -= slice; remaining -= slice;
        if (this.shiftRemaining <= 1e-9) this.teleport(effects);
        continue;
      }
      if (state === 'shift' && animator.frame >= 4 && !this.shiftMistStarted && this.shiftPhase === 'vanish') {
        this.shiftMistStarted = true; effects?.ghostMist?.(boss, false);
      }
      const attack = GHOST_ATTACKS[state];
      if (attack) {
        this.applyRootMotion(animator.frame);
        resolveAttackHits(boss, [this.player], animator.frame, effects);
      }
      if (state === 'attack_9' && !this.thrustRecovering && boss.strikeTargets.get(0)?.has(this.player)) {
        this.finishThrust(); continue;
      }
      const slice = Math.min(remaining, 1 / 120, Math.max(1e-9, 1 / animator.fps - animator.elapsed));
      const advance = attack?.advance;
      const retreating = this.isDodging && this.dodgeProgress < 1;
      const advancing = advance && animator.frame >= advance.startFrame && animator.frame <= advance.endFrame;
      if (retreating) {
        this.trailRemaining -= slice;
        if (this.trailRemaining <= 0) {
          effects?.ghostAfterimage?.(boss); this.trailRemaining += 1 / 30;
        }
      }
      if (retreating) {
        const t0 = this.dodgeProgress, t1 = Math.min(1, t0 + slice / GHOST_CONFIG.dodgeDuration);
        const distance = GHOST_CONFIG.dodgeDistance * ((1 - t0) ** 2 - (1 - t1) ** 2);
        moveHorizontally(boss, -boss.facing * distance, [this.player]);
      }
      if (advancing) {
        moveBossHorizontally(boss, boss.facing * advance.speed * slice * GHOST_CONFIG.attackMotionScale, this.player);
      }
      if (state === 'attack_9' && !this.thrustRecovering && animator.frame >= 3) {
        this.advanceThrust(slice);
        resolveAttackHits(boss, [this.player], animator.frame, effects);
        if (boss.strikeTargets.get(0)?.has(this.player) || boss.x <= 64 || boss.x >= 896) {
          this.finishThrust(); remaining -= slice; continue;
        }
      }
      animator.update(slice, frame => {
        if (attack) {
          this.applyRootMotion(frame);
          resolveAttackHits(boss, [this.player], frame, effects);
        }
      });
      remaining -= slice;
      if (state === 'attack_9' && !this.thrustRecovering) {
        if (boss.strikeTargets.get(0)?.has(this.player)) this.finishThrust();
        continue; // Hold frame 10 and keep charging until contact or the stage edge.
      }
      if (animator.finished) {
        if (state === 'shift' && this.shiftPhase === 'vanish') {
          this.shiftPhase = 'hidden'; this.shiftRemaining = GHOST_CONFIG.shiftWait;
        } else this.finishAction();
      }
    }
  }
}
