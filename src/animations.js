// Row-major sprite sheets; explicit counts exclude transparent padding cells.
const clip = (file, frames, options = {}) => ({
  url: new URL(`../sprites/${file}.png`, import.meta.url).href,
  width: 128, height: 128, columns: 4, frames, fps: 12, loop: false,
  anchorX: 64, anchorY: file.startsWith('player') ? 91 : 107,
  ...options,
});
const bossAttack = (name, frames) => clip(name, frames, { width: 192, height: 192, anchorY: 171 });
// Compensate most authored body travel so world motion and collision stay together.
const ghostClip = (file, frames, options = {}) => clip(file, frames, { anchorY: 99, ...options });
const ghostAttack = (number, frames, width, height, bodyCenters) => ghostClip(`ghost_attack_${number}`, frames, {
  width, height, anchorY: height === 192 ? 163 : 99,
  // Extract authored travel into world position for 1/5/7/10. The matching anchor
  // preserves the original sheet's complete visual displacement, without a second lunge.
  rootXs: [1, 5, 7, 10].includes(number) ? bodyCenters.map(x => x - bodyCenters[0]) : undefined,
  anchorXs: bodyCenters?.map(x => 64 + ([1, 5, 7, 9, 10].includes(number) ? x - bodyCenters[0] : Math.round((x - 65) * .75))),
});
export const ANIMATIONS = {
  ghost: {
    idle: clip('ghost_idle', 12, { loop: true, fps: 8, anchorY: 99 }),
    run: clip('ghost_walk', 8, { loop: true, fps: 8, anchorY: 99, groundY: [99, 100, 100, 100, 100, 100, 99, 99] }),
    attack_1: { ...ghostAttack(1, 20, 192, 192, [65,67,68,69,68,65,64,63,61,60,59,59,69,86,88,87,87,85,84,82,80,78,74]), sourceFrames: 23 },
    attack_2: ghostAttack(2, 17, 128, 128),
    attack_3: ghostAttack(3, 24, 128, 128),
    attack_4: ghostAttack(4, 24, 192, 128, [65,66,65,65,66,69,71,87,86,86,82,78,76,70,70,75,79,84,90,95,93,90,86,83]),
    attack_5: { ...ghostAttack(5, 24, 192, 128, [65,64,64,63,61,61,61,62,61,62,62,63,65,68,72,75,82,83,81,79,76,73,70,66,65,65,65,65,65,65]), sourceFrames: 30 },
    attack_6: ghostAttack(6, 9, 192, 128, [68,69,68,68,72,77,91,94,91]),
    attack_7: { ...ghostAttack(7, 28, 192, 192, [65,65,65,63,63,63,63,64,65,67,70,76,81,88,87,85,86,86,91,94,97,98,99,102,110,110,109,107,107]), sourceFrames: 29 },
    attack_9: ghostAttack(9, 19, 192, 128, [65,67,70,80,80,80,81,81,81,81,82,82,82,82,81,80,78,73,68]),
    attack_10: ghostAttack(10, 27, 128, 128, [66,66,67,68,70,71,71,70,68,67,67,67,68,68,67,63,61,60,60,60,61,62,70,70,69,67,67]),
    float: ghostClip('ghost_float', 21),
    shift: ghostClip('ghost_shift', 19),
    defend: ghostClip('ghost_defend', 13),
    // Keep the first frame's vertical origin through falling, holding and rising.
    down: ghostClip('ghost_down', 8),
    up: ghostClip('ghost_up', 9),
    defeated: ghostClip('ghost_down', 8),
  },
  player: {
    idle: clip('player_idle', 12, { loop: true }),
    run: clip('player_run', 8, { loop: true, groundY: [91, 91, 91, 91, 91, 91, 91, 89] }),
    attack: clip('player_attack', 15, { fps: 16, sourceFrames: 16 }),
    defend_1: clip('player_defend_1', 4, { fps: 16 }),
    defend_2: clip('player_defend_2', 4, { fps: 16 }),
    defend_3: clip('player_defend_3', 12, { fps: 16 }),
    hit: clip('player_hit', 8, { sourceFrames: 13 }),
  },
  boss: {
    idle: clip('boss_idle', 12, { loop: true }),
    run: clip('boss_run', 7, { fps: 8, loop: true, groundY: [106, 107, 107, 106, 107, 107, 107] }),
    attack_1: bossAttack('boss_attack_1', 17),
    attack_2: bossAttack('boss_attack_2', 22),
    attack_3: bossAttack('boss_attack_3', 18),
    jump_attack: bossAttack('boss_jump_attack', 19),
    defend: clip('boss_defend', 9),
    hit: clip('boss_hit', 13),
    down: clip('boss_down', 10, { anchorY: 106 }),
    up: clip('boss_up', 11, { groundY: [106, 106, 106, 106, 107, 107, 107, 107, 107, 107, 107] }),
    // Hands and blade extend below the body plane in the prone frames.
    // Keep the body grounded instead of lifting it to the lowest opaque pixel.
    defeated: clip('boss_defeated', 15, { groundY: [107, 108, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107, 107] }),
  },
};
export const LABELS = { idle: '待机', run: '跑动', attack: '攻击', defend_1: '防御一', defend_2: '防御二', defend_3: '防御三', hit: '受击', attack_1: '攻击一', attack_2: '攻击二', attack_3: '攻击三', jump_attack: '跳跃攻击', defend: '防御', down: '跪倒', up: '起身', defeated: '倒下' };

export class Animator {
  constructor(clips) {
    this.clips = clips;
    this.paused = false;
    this.fps = 12;
    this.play('idle');
  }
  play(name, { restart = false, loop, startFrame = 0, endFrame = this.clips[name]?.frames - 1 } = {}) {
    if (!this.clips[name]) throw new Error(`Unknown animation: ${name}`);
    if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) || startFrame < 0 || endFrame >= this.clips[name].frames || startFrame > endFrame) throw new Error('Invalid animation frame range');
    if (this.name === name && !restart) return;
    this.playbackVersion = (this.playbackVersion ?? 0) + 1;
    this.name = name;
    this.clip = this.clips[name];
    this.fps = this.clip.fps;
    this.loop = loop ?? this.clip.loop;
    this.startFrame = startFrame;
    this.endFrame = endFrame;
    this.frame = startFrame;
    this.elapsed = 0;
    this.finished = false;
  }
  update(dt, onFrame) {
    if (this.paused) return 0;
    if (this.finished) return dt;
    this.elapsed += dt;
    const count = Math.floor((this.elapsed + 1e-9) * this.fps);
    if (!count) return 0;
    // Notify every entered frame, including active frames skipped by a slow render.
    if (onFrame) {
      const playbackVersion = this.playbackVersion;
      const steps = this.loop ? count : Math.min(count, this.endFrame - this.frame);
      for (let step = 1; step <= steps; step++) {
        onFrame(this.startFrame + (this.frame - this.startFrame + step) % (this.endFrame - this.startFrame + 1));
        // A parry can replace this animation inside its hit callback.
        // Do not advance the replacement with the old animation's frame count.
        if (this.playbackVersion !== playbackVersion) return 0;
      }
    }
    if (!this.loop && this.frame + count > this.endFrame) {
      // Preserve time beyond the segment boundary for the next state/segment.
      const overflow = Math.max(0, this.elapsed - (this.endFrame - this.frame + 1) / this.fps);
      this.frame = this.endFrame;
      this.elapsed = 0;
      this.finished = true;
      return overflow;
    }
    this.elapsed = Math.max(0, this.elapsed - count / this.fps);
    if (this.loop) this.frame = this.startFrame + (this.frame - this.startFrame + count) % (this.endFrame - this.startFrame + 1);
    else this.frame += count;
    return 0;
  }
  step() {
    this.paused = true;
    this.frame = this.frame === this.endFrame ? this.startFrame : this.frame + 1;
    this.elapsed = 0;
    this.finished = false;
  }
  get source() {
    const c = this.clip;
    return { x: (this.frame % c.columns) * c.width, y: Math.floor(this.frame / c.columns) * c.height, width: c.width, height: c.height };
  }
  get anchor() { return { x: this.clip.anchorXs?.[this.frame] ?? this.clip.anchorX, y: this.clip.groundY?.[this.frame] ?? this.clip.anchorY }; }
}

export async function loadSprites(sets = Object.values(ANIMATIONS)) {
  const images = new Map();
  await Promise.all(sets.flatMap(Object.values).map(async clip => {
    const img = new Image();
    img.src = clip.url;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error(`无法加载 ${clip.url.split('/').pop()}`));
    });
    if (img.width !== clip.columns * clip.width || img.height < Math.ceil(clip.frames / clip.columns) * clip.height) throw new Error('序列帧尺寸不匹配');
    images.set(clip.url, img);
    // Cache an opaque-white silhouette while preserving the original alpha.
    {
      const white = document.createElement('canvas');
      white.width = img.width; white.height = img.height;
      const context = white.getContext('2d');
      context.drawImage(img, 0, 0);
      context.globalCompositeOperation = 'source-in';
      context.fillStyle = '#fff';
      context.fillRect(0, 0, white.width, white.height);
      images.set(`${clip.url}#white`, white);
    }
  }));
  return images;
}
