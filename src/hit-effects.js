// Each source sprite pixel occupies a 2x2 cell on the game canvas.
import { getHurtbox } from './combat.js';

export const HIT_PIXEL = 2;
const BLADE_FLASH_SECONDS = .20;
const snap = v => Math.round(v / HIT_PIXEL) * HIT_PIXEL;

export function getHitEmissionRing(target) {
  const bossTarget = target.kind === 'boss';
  const body = getHurtbox(target);
  let y = body.y + body.height / 2;
  // Follow the lowered torso through kneeling/rising rather than its standing box.
  if (bossTarget && target.machine.current === 'down') {
    y += Math.min(1, target.animator.frame / 8) * 18 * target.scale;
  } else if (bossTarget && target.machine.current === 'up') {
    y += Math.max(0, 1 - target.animator.frame / 8) * 18 * target.scale;
  }
  return { x: snap(target.x), y: snap(y), radius: body.width / 2 };
}

export function drawHitEmissionRings(ctx, actors) {
  ctx.save(); ctx.fillStyle = '#e98cff';
  for (const actor of actors) {
    const { x, y, radius } = getHitEmissionRing(actor);
    const steps = Math.ceil(2 * Math.PI * radius / HIT_PIXEL);
    for (let i = 0; i < steps; i++) {
      const angle = i / steps * Math.PI * 2;
      ctx.fillRect(snap(x + Math.cos(angle) * radius), snap(y + Math.sin(angle) * radius), HIT_PIXEL, HIT_PIXEL);
    }
    ctx.fillRect(x - HIT_PIXEL, y, HIT_PIXEL * 3, HIT_PIXEL);
    ctx.fillRect(x, y - HIT_PIXEL, HIT_PIXEL, HIT_PIXEL * 3);
  }
  ctx.restore();
}

export function createHitBurst(attacker, target, random) {
  const direction = Math.sign(target.x - attacker.x) || attacker.facing;
  const heavy = attacker.machine.current === 'jump_attack';
  const second = attacker.kind === 'player' && attacker.attackStage === 2;
  const bossTarget = target.kind === 'boss', scale = bossTarget ? 1.5 : 1;
  const duration = heavy ? .29 : .26;
  const reach = (heavy ? 128 : second ? 124 : 110) * scale;
  // Choose one impact direction, then cluster the flashes around it.
  const mainAngle = (random() - .5) * Math.PI / 3;
  const rayProfiles = [[1, 6], [.85, 2.5]];
  if (random() < .5) rayProfiles.push([.95, 2]);
  const ring = getHitEmissionRing(target);
  return { ...ring,
    direction, mainAngle, age: 0, duration, heavy,
    rays: rayProfiles.map(([lengthScale, width]) => {
      const length = reach * lengthScale * (.9 + random() * .1);
      const angle = mainAngle + (random() - .5) * Math.PI / 9;
      return { dx: direction * Math.cos(angle) * length, dy: Math.sin(angle) * length, width: width * scale };
    }),
    particles: Array.from({ length: bossTarget ? (second ? 22 : 18) : (heavy ? 16 : 12) }, (_, i) => {
      // Most exit behind the victim; a smaller, slower spray returns toward the attacker.
      const forward = i % 4 !== 0;
      const sample = random() * 2 - 1;
      // Use the left/right 60-degree sectors, concentrating near horizontal.
      const angle = Math.sign(sample) * Math.abs(sample) ** 1.8 * Math.PI / 3 + (forward ? 0 : Math.PI);
      const horizontal = Math.abs(Math.cos(angle));
      const speed = (forward ? 170 + 450 * horizontal ** 2 : 85 + 100 * horizontal ** 2)
        * (.8 + random() * .4) * scale * .9;
      const nx = Math.cos(angle) * direction, ny = Math.sin(angle);
      const sizeRoll = random();
      // Enlarge the upper end without making the smaller fragments bulky.
      const size = 1 + sizeRoll ** 1.4 * (bossTarget ? 3 : 2.3)
        + sizeRoll ** 4 * (bossTarget ? .8 : .65);
      const aspect = 2.2 + random() * (.6 + 2.8 * horizontal ** 4);
      const shape = particleShape(nx, ny, size, aspect, random);
      return { offsetX: nx * ring.radius, offsetY: ny * ring.radius,
        vx: nx * speed, vy: ny * speed, size, aspect, shape,
        life: duration * (.55 + random() * .45) * (forward ? 1 : .9), drag: 1.4 + random() * 1.2 };
    }),
  };
}

// Bake each irregular droplet once so its eroded edge never flickers between frames.
function particleShape(nx, ny, size, aspect, random) {
  const width = size * HIT_PIXEL * .8, length = width * aspect;
  const phase = random() * Math.PI * 2, bend = (random() - .5) * .35;
  const notch = .3 + random() * .45, side = random() < .5 ? -1 : 1;
  const depth = .18 + random() * .25;
  const boundX = Math.ceil((Math.abs(nx) * length / 2 + Math.abs(ny) * width) / HIT_PIXEL);
  const boundY = Math.ceil((Math.abs(ny) * length / 2 + Math.abs(nx) * width) / HIT_PIXEL);
  const cells = [];
  for (let y = -boundY; y <= boundY; y++) {
    for (let x = -boundX; x <= boundX; x++) {
      const along = (x * nx + y * ny) * HIT_PIXEL;
      const t = along / length + .5;
      if (t <= 0 || t >= 1) continue;
      // Pointed inward tail; fuller, rounded outward head.
      const envelope = t < .68 ? (t / .68) ** 1.25 : Math.sqrt(1 - ((t - .68) / .32) ** 2);
      const warp = width * (bend * Math.sin(t * Math.PI) + .08 * Math.sin(t * 7 + phase));
      const across = (-x * ny + y * nx) * HIT_PIXEL - warp;
      const erosion = Math.sign(across) === side ? depth * Math.exp(-(((t - notch) / .1) ** 2)) : 0;
      const half = width * .5 * envelope * (1 + .1 * Math.sin(t * 17 + phase) - erosion);
      if (Math.abs(across) <= Math.max(.55, half)) cells.push([x * HIT_PIXEL, y * HIT_PIXEL]);
    }
  }
  return cells.length ? cells : [[0, 0]];
}

function bladeFlash(ctx, x, y, dx, dy, width, progress) {
  const stretch = .85 + progress * .65;
  const split = Math.max(0, (progress - .32) / .68);
  const gap = split * .65, drift = split * split * .3;
  const thickness = width * .65 * (1 - progress) ** .8;
  const steps = Math.max(2, Math.ceil(Math.abs(dx) * stretch / HIT_PIXEL));
  for (let column = 0; column <= steps; column++) {
    // The impact center is the widest point, with a 3:1 outgoing/return length.
    const along = column / steps - .25;
    const centered = along / (along < 0 ? .25 : .75);
    if (split > 0 && Math.abs(centered) <= gap) continue;
    const taper = Math.cos(centered * Math.PI / 2) ** .9;
    const innerTaper = split > 0 ? Math.min(1, (Math.abs(centered) - gap) / .15) : 1;
    const half = thickness * taper * innerTaper;
    if (half < .3) continue;
    const cells = Math.max(1, Math.round(half * 2 / HIT_PIXEL));
    // Stretch about the center, then move the two broken halves outward.
    const position = along * stretch + Math.sign(centered) * drift;
    ctx.fillRect(snap(x + dx * position), snap(y + dy * position - cells * HIT_PIXEL / 2),
      HIT_PIXEL, cells * HIT_PIXEL);
  }
}

export function drawHitBursts(ctx, hits, color = '#fff') {
  if (!hits.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  for (const hit of hits) {
    const { x, y, age } = hit;
    if (age < BLADE_FLASH_SECONDS) {
      for (const r of hit.rays ?? []) {
        bladeFlash(ctx, x, y, r.dx, r.dy, r.width, age / BLADE_FLASH_SECONDS);
      }
    }
    for (const p of hit.particles) {
      if (age >= p.life) continue;
      const travel = (1 - Math.exp(-p.drag * age)) / p.drag;
      const originX = x + (p.offsetX ?? 0), originY = y + (p.offsetY ?? 0);
      const px = snap(originX + p.vx * travel), py = snap(originY + p.vy * travel);
      const progress = age / p.life;
      // Keep a solid white (or execution-gray) color; shrink instead of fading.
      const shrink = 1 - Math.max(0, progress - .6) / .4 * .7;
      for (const [sx, sy] of p.shape ?? [[0, 0]]) {
        ctx.fillRect(snap(px + sx * shrink), snap(py + sy * shrink), HIT_PIXEL, HIT_PIXEL);
      }
    }
  }
  ctx.restore();
}
