// Each source sprite pixel occupies a 2x2 cell on the game canvas.
export const HIT_PIXEL = 2;
const snap = v => Math.round(v / HIT_PIXEL) * HIT_PIXEL;

export function createHitBurst(attacker, target, contact, random) {
  const direction = Math.sign(target.x - attacker.x) || attacker.facing;
  const heavy = attacker.machine.current === 'jump_attack';
  const second = attacker.kind === 'player' && attacker.attackStage === 2;
  const duration = heavy ? .55 : .44;
  const reach = heavy ? 96 : second ? 82 : 70;
  let y = contact?.y ?? target.groundY - 60;
  if (['down', 'up'].includes(target.machine.current)) y = Math.max(y, target.groundY - 44);
  return { x: snap(contact?.x ?? target.x - direction * 16), y: snap(y),
    direction, age: 0, duration, heavy, reach,
    rays: Array.from({ length: 8 }, (_, i) => {
      const forward = i < 5, index = forward ? i : i - 5;
      const angle = (index - (forward ? 2 : 1)) * .19 + (random() - .5) * .08;
      const central = index === (forward ? 2 : 1);
      const length = reach * (central ? 1 : .52 + random() * .34) * (forward ? 1 : .55);
      return { dx: direction * (forward ? 1 : -1) * length,
        dy: Math.tan(angle) * length, width: central ? 7 : 3 + random() * 3 };
    }),
    particles: Array.from({ length: heavy ? 42 : second ? 34 : 28 }, (_, i) => {
      // Mainly follow the blow, with a few fragments breaking back at the blade.
      const angle = (random() - .5) * 1.1 + (i % 4 === 0 ? Math.PI : 0);
      const speed = (180 + random() * 320) * (heavy ? 1.2 : 1);
      return { vx: Math.cos(angle) * speed * direction, vy: Math.sin(angle) * speed - 15,
        size: 1 + Math.floor(random() ** 2 * 4),
        life: duration * (.55 + random() * .45), drag: 2.5 + random() * 2,
        trail: .014 + random() * .02 };
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
    if (age < .14) {
      const strength = 1 - age / .14, extension = .8 + .2 * strength;
      for (const ray of hit.rays) cone(ctx, x, y, ray.dx * extension, ray.dy * extension, ray.width * strength);
    }
    for (const p of hit.particles) {
      if (age >= p.life) continue;
      const t = age + .012, previous = Math.max(0, t - p.trail);
      const travel = (1 - Math.exp(-p.drag * t)) / p.drag;
      const oldTravel = (1 - Math.exp(-p.drag * previous)) / p.drag;
      const px = snap(x + p.vx * travel), py = snap(y + p.vy * travel + 200 * t * t);
      const tx = snap(x + p.vx * oldTravel), ty = snap(y + p.vy * oldTravel + 200 * previous * previous);
      const progress = age / p.life;
      // Keep a solid white (or execution-gray) color; shrink instead of fading.
      streak(ctx, tx, ty, px, py);
      const size = Math.max(1, p.size - Math.floor(progress * 2));
      ctx.fillRect(px, py, size * HIT_PIXEL, size * HIT_PIXEL);
    }
  }
  ctx.restore();
}
