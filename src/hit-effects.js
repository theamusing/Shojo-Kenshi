// Each source sprite pixel occupies a 2x2 cell on the game canvas.
export const HIT_PIXEL = 2;
const snap = v => Math.round(v / HIT_PIXEL) * HIT_PIXEL;
const COLORS = ['#fff1cd', '#e6cba3', '#b98766', '#754b45'];

export function createHitBurst(attacker, target, contact, random) {
  const direction = Math.sign(target.x - attacker.x) || attacker.facing;
  const heavy = attacker.machine.current === 'jump_attack';
  const second = attacker.kind === 'player' && attacker.attackStage === 2;
  const duration = heavy ? .55 : .44;
  let y = contact?.y ?? target.groundY - 60;
  if (['down', 'up'].includes(target.machine.current)) y = Math.max(y, target.groundY - 44);
  return { x: snap(contact?.x ?? target.x - direction * 16), y: snap(y),
    direction, age: 0, duration, heavy, slash: second ? 1 : -1,
    reach: heavy ? 54 : second ? 44 : 36,
    particles: Array.from({ length: heavy ? 42 : second ? 34 : 28 }, (_, i) => {
      // Mainly follow the blow, with a few fragments breaking back at the blade.
      const angle = (random() - .5) * 2.6 + (i % 3 === 0 ? Math.PI : 0);
      const speed = (200 + random() * 420) * (heavy ? 1.25 : 1);
      return { vx: Math.cos(angle) * speed * direction, vy: Math.sin(angle) * speed - 65,
        size: i % 7 === 0 ? 4 : i % 3 === 0 ? 2 : 1,
        life: duration * (.55 + random() * .45), drag: 2.5 + random() * 2,
        color: i % 3, trail: .018 + random() * .025 };
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

export function drawHitBursts(ctx, hits) {
  if (!hits.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  for (const hit of hits) {
    const { x, y, age, direction, slash } = hit;
    if (age < .10) {
      const strength = 1 - age / .10, reach = hit.reach * (.55 + .45 * strength);
      ctx.fillStyle = '#b96942';
      streak(ctx, x - direction * reach * .65, y - slash * reach * .45,
        x + direction * reach, y + slash * reach * .7, 2);
      ctx.fillStyle = '#fff4da';
      streak(ctx, x - direction * reach * .7, y - slash * reach * .5,
        x + direction * reach * .95, y + slash * reach * .65);
      const radius = Math.max(1, Math.ceil((hit.heavy ? 6 : 4) * strength));
      for (let row = -radius; row <= radius; row++) {
        const half = radius - Math.abs(row);
        ctx.fillRect(x - half * HIT_PIXEL, y + row * HIT_PIXEL, (half * 2 + 1) * HIT_PIXEL, HIT_PIXEL);
      }
      streak(ctx, x - reach * .3, y + slash * reach * .3, x + reach * .3, y - slash * reach * .3);
    }
    for (const p of hit.particles) {
      if (age >= p.life) continue;
      const t = age + .012, previous = Math.max(0, t - p.trail);
      const travel = (1 - Math.exp(-p.drag * t)) / p.drag;
      const oldTravel = (1 - Math.exp(-p.drag * previous)) / p.drag;
      const px = snap(x + p.vx * travel), py = snap(y + p.vy * travel + 200 * t * t);
      const tx = snap(x + p.vx * oldTravel), ty = snap(y + p.vy * oldTravel + 200 * previous * previous);
      const progress = age / p.life;
      // Palette shifts and shrinking cells replace soft transparency fades.
      ctx.fillStyle = COLORS[Math.min(3, p.color + Math.floor(progress * 2))];
      streak(ctx, tx, ty, px, py);
      const size = Math.max(1, p.size - Math.floor(progress * 2));
      ctx.fillRect(px, py, size * HIT_PIXEL, size * HIT_PIXEL);
    }
  }
  ctx.restore();
}
