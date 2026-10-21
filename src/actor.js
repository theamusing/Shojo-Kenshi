import { ANIMATIONS, Animator } from './animations.js';
import { resolveAttackHits } from './combat.js';
import { moveHorizontally } from './physics.js';

// Each three-frame step advances 24 world pixels at the default 16fps.
export const ATTACK_STEP_SPEED = 128;

export class StateMachine {
  constructor(states, initial) { this.states = states; this.current = null; this.change(initial); }
  change(name, force = false) {
    if (!(name in this.states)) throw new Error(`Unknown state: ${name}`);
    if (this.current === name && !force) return;
    this.states[this.current]?.exit?.();
    this.current = name;
    this.states[name].enter?.();
  }
  update(dt, input) { this.states[this.current]?.update?.(dt, input); }
}

export class Actor {
  constructor(kind, x, groundY, facing = 1) {
    this.kind = kind;
    this.x = x;
    this.groundY = groundY;
    this.facing = facing;
    this.speed = kind === 'boss' ? 96 : 160;
    this.scale = 2;
    this.renderOffsetY = kind === 'boss' ? 1 : 0;
    this.previewing = false;
    this.attackStage = null;
    this.attackRecoveryFrame = null;
    this.attackQueued = false;
    this.hitTargets = new Set();
    this.strikeTargets = new Map();
    this.swingFrames = new Set();
    this.flashRemaining = 0;
    this.knockbackVelocity = 0;
    this.knockbackRemaining = 0;
    this.animator = new Animator(ANIMATIONS[kind]);
    const states = Object.fromEntries(Object.keys(ANIMATIONS[kind]).map(name => [name, {
      enter: () => {
        this.strikeTargets.clear();
        this.swingFrames.clear();
        this.animator.play(name, { restart: true, loop: this.previewing ? true : undefined });
      },
    }]));
    if (kind === 'player') states.attack = {
      enter: () => {
        if (this.previewing) this.animator.play('attack', { restart: true, loop: true });
        else this.startAttackSegment(1);
      },
      exit: () => { this.attackStage = null; this.attackRecoveryFrame = null; this.attackQueued = false; this.hitTargets.clear(); },
    };
    if (kind === 'player') states.hit = {
      enter: () => this.animator.play('hit', { restart: true, loop: this.previewing }),
      exit: () => { this.knockbackVelocity = 0; this.knockbackRemaining = 0; },
    };
    if (kind === 'player') for (const guard of ['defend_1', 'defend_2', 'defend_3']) {
      states[guard].exit = () => { this.knockbackVelocity = 0; this.knockbackRemaining = 0; };
    }
    this.machine = new StateMachine(states, 'idle');
  }
  preview(name) {
    this.previewing = true;
    this.animator.paused = false;
    this.machine.change(name, true);
  }
  resume() {
    this.previewing = false;
    this.flashRemaining = 0;
    this.knockbackVelocity = 0;
    this.knockbackRemaining = 0;
    this.animator.paused = false;
    this.machine.change('idle', true);
  }
  startAttackSegment(stage) {
    this.swingFrames.clear();
    this.attackStage = stage;
    this.attackRecoveryFrame = null;
    this.attackQueued = false;
    this.hitTargets.clear();
    this.animator.play('attack', {
      restart: true, loop: false,
      startFrame: stage === 1 ? 0 : 7,
      endFrame: stage === 1 ? 6 : 14,
    });
  }
  startAttackRecovery(frame = 6) {
    this.attackRecoveryFrame = frame;
    this.attackQueued = false;
    this.animator.play('attack', { restart: true, loop: false, startFrame: frame, endFrame: frame });
  }
  get canMove() { return this.machine.current === 'idle' || this.machine.current === 'run'; }
  get elevation() {
    if (this.kind !== 'boss' || this.machine.current !== 'jump_attack') return 0;
    // A small hop from frame 4 to frame 13, landing before the strike.
    // Derive height from animation time so pause, preview and reset stay in sync.
    const time = this.animator.frame + this.animator.elapsed * this.animator.fps;
    const progress = Math.max(0, Math.min(1, (time - 3) / 9));
    return Math.round(4 * 16 * progress * (1 - progress)) * this.scale;
  }
  get isGuarding() { return !this.previewing && ['defend_1', 'defend_2', 'defend_3'].includes(this.machine.current); }
  receiveHit(attacker, knockbackSpeed = 360) {
    if (this.kind !== 'player' || this.previewing) return;
    this.facing = Math.sign(attacker.x - this.x) || -attacker.facing;
    this.animator.paused = false;
    this.machine.change('hit', true); // Restart even when already in hit: no invulnerability.
    this.flashRemaining = 1 / 12;
    this.knockbackVelocity = -this.facing * knockbackSpeed;
    this.knockbackRemaining = 8 / 12;
  }
  receiveGuardRecoil(attacker) {
    if (this.kind !== 'player' || !this.isGuarding) return;
    const away = Math.sign(this.x - attacker.x) || attacker.facing;
    this.knockbackVelocity = away * 180;
    // Keep the original guard window; recoil never restarts or extends it.
    this.knockbackRemaining = Math.min(.2,
      (this.animator.endFrame - this.animator.frame + 1) / this.animator.fps - this.animator.elapsed);
  }
  receiveGuardImpact(attacker, knockbackSpeed) {
    if (this.kind !== 'player' || this.previewing) return;
    this.facing = Math.sign(attacker.x - this.x) || -attacker.facing;
    this.animator.paused = false;
    this.machine.change('defend_3', true);
    this.flashRemaining = 0;
    this.knockbackVelocity = -this.facing * knockbackSpeed;
    // Match the hit displacement exactly, despite defend_3 lasting longer.
    this.knockbackRemaining = 8 / 12;
  }
  recover(direction) {
    this.machine.change(this.kind === 'player' && direction ? 'run' : 'idle');
    if (this.kind === 'player' && direction) this.facing = direction;
  }
  handleActions(actions, direction) {
    // A guard press wins even when J and K arrive in the same render interval.
    if (actions.includes('defend')) {
      if (this.canMove || this.machine.current === 'attack') {
        if (this.canMove && direction) this.facing = direction;
        this.animator.paused = false;
        this.machine.change(Math.random() < 0.5 ? 'defend_1' : 'defend_2');
      }
      return;
    }
    for (const action of actions) {
      if (action !== 'attack') continue;
      if (this.canMove) {
        if (direction) this.facing = direction;
        this.animator.paused = false;
        this.machine.change('attack');
      } else if (this.machine.current === 'attack') {
        if (this.attackRecoveryFrame !== null) this.startAttackSegment(2);
        else this.attackQueued = true;
      }
    }
  }
  update(dt, direction = 0, actions = [], targets = [], effects = null) {
    this.flashRemaining = Math.max(0, this.flashRemaining - dt);
    if (this.kind === 'player') {
      if (this.previewing && (direction || actions.length)) this.resume();
      if (!this.previewing) this.handleActions(actions, direction);
    }
    if (this.previewing) { this.animator.update(dt); return; }
    let remaining = dt;
    do {
      const attacking = this.kind === 'player' && this.machine.current === 'attack' && !this.animator.paused;
      // Advance attack movement and hit checks together at frame boundaries.
      const slice = attacking
        ? Math.min(remaining, Math.max(0, 1 / this.animator.fps - this.animator.elapsed))
        : remaining;
      if (this.canMove) {
        this.recover(direction);
        if (this.kind === 'player' && direction) {
          this.animator.paused = false;
          moveHorizontally(this, direction * this.speed * remaining, targets);
        }
      }
      if (this.kind === 'player' && (this.machine.current === 'hit' || this.isGuarding) && !this.animator.paused) {
        const hitTime = Math.max(0, Math.min(remaining, this.knockbackRemaining,
          (this.animator.endFrame - this.animator.frame + 1) / this.animator.fps - this.animator.elapsed));
        const decay = Math.exp(-8 * Math.max(0, hitTime));
        moveHorizontally(this, this.knockbackVelocity * (1 - decay) / 8, targets);
        this.knockbackVelocity *= decay;
        this.knockbackRemaining = Math.max(0, this.knockbackRemaining - hitTime);
      }
      if (attacking && this.attackRecoveryFrame === null
        && ((this.animator.frame >= 4 && this.animator.frame <= 6)
          || (this.animator.frame >= 11 && this.animator.frame <= 13))) {
        resolveAttackHits(this, targets, this.animator.frame, effects);
        moveHorizontally(this, this.facing * ATTACK_STEP_SPEED * slice, targets);
      }
      this.machine.update(slice, direction);
      resolveAttackHits(this, targets, this.animator.frame, effects);
      const overflow = this.animator.update(slice, frame => resolveAttackHits(this, targets, frame, effects));
      remaining = Math.max(0, remaining - slice + overflow);
      if (this.machine.current === 'defeated') break;
      if (!this.animator.finished) continue;
      if (this.kind === 'player' && this.machine.current === 'attack') {
        if (this.attackRecoveryFrame === 6) this.startAttackRecovery(5);
        else if (this.attackRecoveryFrame === 5) this.recover(direction);
        else if (this.attackQueued) this.startAttackSegment(this.attackStage === 1 ? 2 : 1);
        else if (this.attackStage === 1) this.startAttackRecovery();
        else this.recover(direction);
      } else this.recover(direction);
    } while (remaining > 1e-9);
  }
  draw(ctx, images, guides = false, { silhouette = false } = {}) {
    const animator = this.animator, source = animator.source, anchor = animator.anchor, scale = this.scale;
    ctx.save();
    ctx.translate(Math.round(this.x), this.groundY + this.renderOffsetY * scale - this.elevation);
    ctx.scale(this.facing * scale, scale);
    ctx.imageSmoothingEnabled = false;
    if (silhouette) ctx.filter = this.kind === 'player' ? 'brightness(0)' : 'brightness(0) invert(0.45)';
    else if (this.kind === 'boss' && this.machine.current === 'defeated') ctx.filter = 'saturate(0.15)';
    const sprite = !silhouette && this.flashRemaining > 0 ? images.get(`${animator.clip.url}#white`) ?? images.get(animator.clip.url) : images.get(animator.clip.url);
    ctx.drawImage(sprite, source.x, source.y, source.width, source.height, -anchor.x, -anchor.y, source.width, source.height);
    if (guides) {
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = this.kind === 'player' ? '#c4e5cc' : '#e3ad79';
      ctx.strokeRect(-anchor.x, -anchor.y, source.width, source.height);
      ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -4); ctx.lineTo(0, 4); ctx.stroke();
    }
    ctx.restore();
  }
}
