// Each source sprite pixel occupies a 2x2 cell on the game canvas.
import { getHurtbox } from './combat.js';

export const HIT_PIXEL = 2;
const snap = v => Math.round(v / HIT_PIXEL) * HIT_PIXEL;

export function createHitBurst(attacker, target, random) {
  const direction = Math.sign(target.x - attacker.x) || attacker.facing;
  const heavy = attacker.machine.current === 'jump_attack';
  const second = attacker.kind === 'player' && attacker.attackStage === 2;
  const bossTarget = target.kind === 'boss', scale = bossTarget ? 1.5 : 1;
  const duration = heavy ? .40 : .36;
  const reach = (heavy ? 128 : second ? 124 : 110) * scale;
  const body = getHurtbox(target);
  let y = body.y + body.height / 2;
  // Follow the lowered torso through kneeling/rising rather than its standing box.
  if (bossTarget && target.machine.current === 'down') {
    y += Math.min(1, target.animator.frame / 8) * 18 * target.scale;
  } else if (bossTarget && target.machine.current === 'up') {
    y += Math.max(0, 1 - target.animator.frame / 8) * 18 * target.scale;
  }
  return { x: snap(target.x), y: snap(y),
    direction, age: 0, duration, heavy, reach,
    rays: Array.from({ length: 5 }, (_, i) => {
      const forward = i < 4;
      // One broad spear, one medium wedge, two fine accents, one short back-spray.
      const angle = [-.23, -.04, .14, .28, -.08][i] + (random() - .5) * .035;
      const length = reach * [.82, 1, .72, .90, .22][i] * (.95 + random() * .05);
      return { dx: direction * (forward ? 1 : -1) * length,
        dy: Math.tan(angle) * length, width: [2, 11, 5.5, 1.5, 2.5][i] * scale };
    }),
    particles: Array.from({ length: bossTarget ? (second ? 22 : 18) : (heavy ? 16 : 12) }, (_, i) => {
      // About 85% exit behind the victim; the few returning flecks are short.
      const forward = i % 7 !== 0;
      const angle = (random() - .5) * .9 + (forward ? 0 : Math.PI);
      const speed = (420 + random() * 320) * scale * (forward ? 1 : .27);
      const chunky = i % 3 === 0 || random() < .2;
      return { vx: Math.cos(angle) * speed * direction, vy: Math.sin(angle) * speed,
        size: chunky ? (bossTarget ? 4 : 3) + Math.floor(random() * 3) : 1 + Math.floor(random() * 2),
        life: duration * (.55 + random() * .45) * (forward ? 1 : .7), drag: 1.4 + random() * 1.2,
        trail: i % 3 === 0 ? 0 : .006 + random() * .01 };
    }),
  };
}

// Square-cell rasterization avoids thin anti-aliased canvas strokes.
function streak(ctx, x0, y0, x1, y1, size = 1) {
  let x = Math.round(x0 / HIT_PIXEL), y = Math.round(y0 / HIT_PIXEL);
  const endX = Math.round(x1 / HIT_PIXEL), endY = Math.round(y1 / HIT_PIXEL);
  const dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
  const sx = x < endX ? 1 : -1, sy = y < endY ? 1 : -1;
  let error = dx + dy;
  while (true) {
    ctx.fillRect(x * HIT_PIXEL, y * HIT_PIXEL, size * HIT_PIXEL, size * HIT_PIXEL);
    if (x === endX && y === endY) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
}

// Filled, tapering cones, rasterized in columns of source-sized pixels.
function cone(ctx, x, y, dx, dy, width) {
  const steps = Math.max(1, Math.round(Math.abs(dx) / HIT_PIXEL));
  const direction = Math.sign(dx);
  for (let column = 0; column <= steps; column++) {
    const t = column / steps;
    const half = Math.max(0, Math.round(width * (1 - t) ** 1.4 / HIT_PIXEL));
    ctx.fillRect(x + direction * column * HIT_PIXEL, snap(y + dy * t) - half * HIT_PIXEL,
      HIT_PIXEL, (half * 2 + 1) * HIT_PIXEL);
  }
}

export function drawHitBursts(ctx, hits, color = '#fff') {
  if (!hits.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  for (const hit of hits) {
    const { x, y, age } = hit;
    if (age < .17) {
      const strength = 1 - age / .17, extension = .85 + .15 * strength;
      for (const ray of hit.rays) cone(ctx, x, y, ray.dx * extension, ray.dy * extension, ray.width * Math.sqrt(strength));
    }
    for (const p of hit.particles) {
      if (age >= p.life) continue;
      const t = age + .012, previous = Math.max(0, t - p.trail);
      const travel = (1 - Math.exp(-p.drag * t)) / p.drag;
      const oldTravel = (1 - Math.exp(-p.drag * previous)) / p.drag;
      const px = snap(x + p.vx * travel), py = snap(y + p.vy * travel);
      const tx = snap(x + p.vx * oldTravel), ty = snap(y + p.vy * oldTravel);
      const progress = age / p.life;
      // Keep a solid white (or execution-gray) color; shrink instead of fading.
      const size = Math.max(1, p.size - Math.floor(Math.max(0, progress - .6) / .4 * (p.size - 1)));
      if (p.trail > 0) streak(ctx, tx, ty, px, py, Math.max(1, Math.floor(size * .6)));
      ctx.fillRect(px, py, size * HIT_PIXEL, size * HIT_PIXEL);
    }
  }
  ctx.restore();
}
