// Sword contact points in source pixels relative to the actor's feet.
import { createHitBurst, drawHitBursts } from './hit-effects.js';

const GUARD_POINTS = {
  defend_1: [[18, -32], [-4, -47], [-12, -40], [-19, -31]],
  defend_2: [[16, -33], [10, -42], [6, -49], [5, -49]],
  defend_3: [[8, -42]],
};
const CLASH_STYLES = {
  parry: { count: 48, duration: .52, flash: .16, radius: 84, reach: 88, core: 12, speed: 1, brightness: 1 },
  heavy: { count: 64, duration: .6, flash: .19, radius: 108, reach: 110, core: 15, speed: 1.2, brightness: 1 },
  break: { count: 88, duration: .7, flash: .23, radius: 138, reach: 132, core: 19, speed: 1.4, brightness: 1 },
  block: { count: 20, duration: .34, flash: .12, radius: 42, reach: 39, core: 6, speed: .58, brightness: .72 },
};
export function guardPoint(actor) {
  const points = actor.kind === 'boss' ? [[18, -43]] : GUARD_POINTS[actor.machine.current] ?? [[12, -40]];
  const [x, y] = points[Math.min(actor.animator.frame, points.length - 1)];
  return { x: Math.round(actor.x + x * actor.facing * actor.scale),
    y: actor.groundY + (y + (actor.renderOffsetY ?? 0)) * actor.scale - (actor.elevation ?? 0) };
}

export class CombatEffects {
  constructor(random = Math.random, audio = null) {
    this.random = random; this.audio = audio; this.bursts = []; this.hits = []; this.ripples = []; this.shake = null;
  }
  clear() { this.bursts.length = 0; this.hits.length = 0; this.ripples.length = 0; this.shake = null; this.audio?.clearEffects(); }
  swing(actor) { this.audio?.swing(actor); }
  impact(attacker, target) {
    this.audio?.impact(attacker, target);
    this.hits.push(createHitBurst(attacker, target, this.random));
  }
  bossBlock(boss) { this.audio?.bossBlock(boss); this.clash(guardPoint(boss), 'block'); }
  parry(player, heavy = false, breaksPosture = false) {
    this.audio?.parry(player, heavy, breaksPosture);
    this.clash(guardPoint(player), breaksPosture ? 'break' : heavy ? 'heavy' : 'parry');
    this.shake = { age: 0, duration: breaksPosture ? .24 : heavy ? .17 : .13,
      amplitude: breaksPosture ? 4 : heavy ? 2.6 : 1.8 };
  }
  postureBreak(boss) {
    this.ripples.push({ x: boss.x, y: boss.groundY - 76, age: 0, duration: .85 });
  }
  get cameraOffset() {
    if (!this.shake) return { x: 0, y: 0 };
    const { age, duration, amplitude } = this.shake;
    const strength = amplitude * (1 - age / duration) ** 2;
    return { x: Math.round(Math.sin(age * 185 + 1.2) * strength),
      y: Math.round(Math.sin(age * 149 + .5) * strength * .65) };
  }
  clash(point, style) {
    const profile = CLASH_STYLES[style];
    const particles = Array.from({ length: profile.count }, (_, i) => {
      // Radial needles with an upward kick, followed by drag and gravity.
      const angle = i / profile.count * Math.PI * 2 + (this.random() - .5) * .4;
      const speed = (200 + this.random() * 440) * profile.speed;
      return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 65 * profile.speed,
        size: i % 4 === 0 ? 2 : 1, life: profile.duration * (.55 + this.random() * .45),
        trail: .018 + this.random() * .024, drag: 1.8 + this.random() * 1.5 };
    });
    this.bursts.push({ ...point, ...profile, style, age: 0, particles });
  }
  update(dt) {
    for (const hit of this.hits) hit.age += dt;
    this.hits = this.hits.filter(hit => hit.age < hit.duration);
    for (const burst of this.bursts) burst.age += dt;
    this.bursts = this.bursts.filter(burst => burst.age < burst.duration);
    for (const ripple of this.ripples) ripple.age += dt;
    this.ripples = this.ripples.filter(ripple => ripple.age < ripple.duration);
    if (this.shake) { this.shake.age += dt; if (this.shake.age >= this.shake.duration) this.shake = null; }
  }
  drawRipples(ctx, scene) {
    // Refract a thin ring of the already-rendered scene, leaving the HUD untouched.
    for (const ripple of this.ripples) for (let ring = 0; ring < 3; ring++) {
      const t = (ripple.age - ring * .09) / (ripple.duration - .18);
      if (t < 0 || t >= 1) continue;
      const radius = 18 + 210 * (1 - (1 - t) ** 1.4);
      const width = 5 + 8 * (1 - t), fade = (1 - t) ** 1.8;
      const { x, y } = ripple;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, y, radius + width, 0, Math.PI * 2);
      ctx.arc(x, y, Math.max(0, radius - width), 0, Math.PI * 2, true);
      ctx.clip('evenodd');
      const distortion = 1 + Math.sin(t * Math.PI) * .045;
      ctx.translate(x, y); ctx.scale(distortion, distortion);
      ctx.drawImage(scene, -x, -y); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * .42; ctx.strokeStyle = '#a5e9ef'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = fade * .8; ctx.strokeStyle = '#fff1cb'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, radius + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  draw(ctx, { showHits = true } = {}) {
    if (showHits) drawHitBursts(ctx, this.hits);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const burst of this.bursts) {
      const { x, y, age, brightness } = burst;
      if (age < burst.flash) {
        const strength = (1 - age / burst.flash) ** 1.4;
        const radius = burst.radius * (.8 + .2 * strength);
        ctx.globalAlpha = brightness;
        const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
        glow.addColorStop(0, `rgba(255,255,235,${strength})`);
        glow.addColorStop(.14, `rgba(255,238,160,${strength})`);
        glow.addColorStop(.42, `rgba(255,157,37,${strength * .65})`);
        glow.addColorStop(1, 'rgba(255,85,10,0)');
        ctx.fillStyle = glow; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
        const reach = burst.reach * strength + 4, core = burst.core * strength;
        ctx.globalAlpha = brightness * strength;
        ctx.fillStyle = '#ffd17c';
        ctx.beginPath();
        ctx.moveTo(x - reach, y); ctx.lineTo(x - core, y - core * .4);
        ctx.lineTo(x - reach * .45, y - reach * .4); ctx.lineTo(x - core * .4, y - core);
        ctx.lineTo(x, y - reach * .65); ctx.lineTo(x + core * .4, y - core);
        ctx.lineTo(x + reach * .45, y - reach * .4); ctx.lineTo(x + core, y - core * .4);
        ctx.lineTo(x + reach, y); ctx.lineTo(x + core, y + core * .4);
        ctx.lineTo(x + reach * .45, y + reach * .4); ctx.lineTo(x + core * .4, y + core);
        ctx.lineTo(x, y + reach * .65); ctx.lineTo(x - core * .4, y + core);
        ctx.lineTo(x - reach * .45, y + reach * .4); ctx.lineTo(x - core, y + core * .4);
        ctx.closePath(); ctx.fill();
        // The small white-hot cross sits above the amber flare.
        ctx.fillStyle = '#ffffee';
        ctx.fillRect(Math.round(x - core), Math.round(y - core * .5), Math.ceil(core * 2), Math.ceil(core));
        ctx.fillRect(Math.round(x - core * .5), Math.round(y - core), Math.ceil(core), Math.ceil(core * 2));
      }
      for (const p of burst.particles) {
        if (age >= p.life) continue;
        const t = age + .008, previous = Math.max(0, t - p.trail);
        const travel = (1 - Math.exp(-p.drag * t)) / p.drag;
        const oldTravel = (1 - Math.exp(-p.drag * previous)) / p.drag;
        const px = Math.round(x + p.vx * travel), py = Math.round(y + p.vy * travel + 260 * t * t);
        const tx = Math.round(x + p.vx * oldTravel), ty = Math.round(y + p.vy * oldTravel + 260 * previous * previous);
        const fade = (1 - age / p.life) ** 1.3 * brightness;
        // A dim orange edge surrounds each thin, hot needle; tips cool into embers.
        ctx.globalAlpha = fade * .35; ctx.lineWidth = p.size + 2; ctx.strokeStyle = '#ff751d';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py); ctx.stroke();
        ctx.globalAlpha = fade; ctx.lineWidth = p.size;
        ctx.strokeStyle = age < p.life * .35 ? '#fff0b3' : '#ffa43e';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(px, py); ctx.stroke();
        ctx.fillStyle = age < p.life * .2 ? '#fffde1' : '#ffc36b';
        ctx.fillRect(px, py, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
