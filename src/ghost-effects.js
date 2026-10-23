const snap = value => Math.round(value / 2) * 2;

export function createGhostAfterimage(actor) {
  return { x: snap(actor.x), y: snap(actor.groundY + actor.renderOffsetY * actor.scale - actor.elevation),
    facing: actor.facing, scale: actor.scale, url: actor.animator.clip.url,
    source: { ...actor.animator.source }, anchor: { ...actor.animator.anchor }, age: 0, duration: .18 };
}

export function drawGhostAfterimages(ctx, afterimages, images, silhouette = false) {
  for (const trail of afterimages) {
    const sprite = images.get(trail.url);
    if (!sprite) continue;
    const { source, anchor } = trail;
    ctx.save();
    ctx.globalAlpha *= .3 * (1 - trail.age / trail.duration) ** 2;
    ctx.filter = silhouette ? 'brightness(0) invert(0.45)' : 'saturate(0.1) brightness(1.5)';
    ctx.imageSmoothingEnabled = false;
    ctx.translate(trail.x, trail.y); ctx.scale(trail.facing * trail.scale, trail.scale);
    ctx.drawImage(sprite, source.x, source.y, source.width, source.height,
      -anchor.x, -anchor.y, source.width, source.height);
    ctx.restore();
  }
}

export function createGhostMist(actor, appearing, random) {
  return { x: actor.x, y: actor.groundY - 70, age: 0, duration: .8, appearing,
    particles: Array.from({ length: 38 }, () => ({
      x: (random() - .5) * 65, y: (random() - .5) * 136,
      vx: (random() - .5) * 135, vy: -22 - random() * 66,
      size: 4 + Math.floor(random() * 5) * 2, life: .42 + random() * .38,
      shade: Math.floor(random() * 3), notch: random() < .5 ? -1 : 1,
    })) };
}

export function drawGhostMist(ctx, mists) {
  ctx.save(); ctx.globalCompositeOperation = 'source-over';
  for (const mist of mists) for (const p of mist.particles) {
    const t = mist.age / p.life;
    if (t >= 1) continue;
    const drift = mist.appearing ? (1 - t) ** 1.5 * .65 : mist.age;
    const x = snap(mist.x + p.x + p.vx * drift), y = snap(mist.y + p.y + p.vy * drift);
    const size = Math.max(2, snap(p.size * (mist.appearing ? 1 - t * .6 : 1 + t * .7)));
    ctx.globalAlpha = .55 * (1 - t) * Math.min(1, mist.age / .05 + .3);
    ctx.fillStyle = ['#d6e1d8', '#9ab6b4', '#62878c'][p.shade];
    // Stepped clusters with missing corners, at exactly the sprite's 2px grid.
    ctx.fillRect(x - size, y, size * 2, size);
    ctx.fillRect(x - size + p.notch * 2, y - size / 2 + (size % 4 ? 1 : 0), size, size);
    ctx.fillRect(x + p.notch * size, y + size, Math.max(2, size - 2), 2);
  }
  ctx.restore();
}
