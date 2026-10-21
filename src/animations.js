// Row-major sprite sheets; explicit counts exclude transparent padding cells.
const clip = (file, frames, options = {}) => ({
  url: new URL(`../sprites/${file}.png`, import.meta.url).href,
  width: 128, height: 128, columns: 4, frames, fps: 12, loop: false,
  anchorX: 64, anchorY: file.startsWith('player') ? 91 : 107,
  ...options,
});
const bossAttack = (name, frames) => clip(name, frames, { width: 192, height: 192, anchorY: 171 });
export const ANIMATIONS = {
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
    defeated: clip('boss_defeated', 15, { groundY: [107, 108, 107, 107, 107, 107, 107, 107, 107, 111, 112, 112, 112, 112, 112] }),
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
      const steps = this.loop ? count : Math.min(count, this.endFrame - this.frame);
      for (let step = 1; step <= steps; step++) {
        onFrame(this.startFrame + (this.frame - this.startFrame + step) % (this.endFrame - this.startFrame + 1));
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
  get anchor() { return { x: this.clip.anchorX, y: this.clip.groundY?.[this.frame] ?? this.clip.anchorY }; }
}

export async function loadSprites() {
  const images = new Map();
  await Promise.all(Object.values(ANIMATIONS).flatMap(Object.values).map(async clip => {
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
