// Each source sprite pixel occupies a 2x2 cell on the game canvas.
import { getHurtbox } from './combat.js';

export const HIT_PIXEL = 2;
const snap = v => Math.round(v / HIT_PIXEL) * HIT_PIXEL;

export function createHitBurst(attacker, target, random) {
  const direction = Math.sign(target.x - attacker.x) || attacker.facing;
  const heavy = attacker.machine.current === 'jump_attack';
  const second = attacker.kind === 'player' && attacker.attackStage === 2;
  const bossTarget = target.kind === 'boss', scale = bossTarget ? 1.5 : 1;
  const duration = heavy ? .28 : .24;
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
    rays: Array.from({ length: 10 }, (_, i) => {
      const forward = i < 8, index = forward ? i : i - 8;
      const angle = (index - (forward ? 3.5 : .5)) * .085 + (random() - .5) * .05;
      const central = forward && (index === 3 || index === 4);
      const length = reach * (central ? 1 : .65 + random() * .35) * (forward ? 1 : .24);
      return { dx: direction * (forward ? 1 : -1) * length,
        dy: Math.tan(angle) * length, width: (central ? 7 : 2 + random() * 3) * scale * (forward ? 1 : .45) };
    }),
    particles: Array.from({ length: bossTarget ? (second ? 46 : 40) : (heavy ? 34 : 28) }, (_, i) => {
      // About 85% exit behind the victim; the few returning flecks are short.
      const forward = i % 7 !== 0;
      const angle = (random() - .5) * .9 + (forward ? 0 : Math.PI);
      const speed = (600 + random() * 480) * scale * (forward ? 1 : .27);
      return { vx: Math.cos(angle) * speed * direction, vy: Math.sin(angle) * speed,
        size: 1 + Math.floor(random() ** 2 * (bossTarget ? 5 : 4)),
        life: duration * (.55 + random() * .45) * (forward ? 1 : .7), drag: 1.4 + random() * 1.2,
        trail: .01 + random() * .015 };
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
    if (age < .11) {
      const strength = 1 - age / .11, extension = .85 + .15 * strength;
      for (const ray of hit.rays) cone(ctx, x, y, ray.dx * extension, ray.dy * extension, ray.width * strength);
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
      streak(ctx, tx, ty, px, py);
      const size = Math.max(1, p.size - Math.floor(progress * 2));
      ctx.fillRect(px, py, size * HIT_PIXEL, size * HIT_PIXEL);
    }
  }
  ctx.restore();
}
