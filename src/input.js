export const GAME_KEYS = new Set(['KeyA', 'KeyD', 'KeyJ', 'KeyK', 'KeyH']);

export class KeyboardInput {
  constructor() { this.held = new Set(); this.actions = []; }
  press(code, repeat = false) {
    if (!GAME_KEYS.has(code) || repeat || this.held.has(code)) return;
    this.held.add(code);
    if (code === 'KeyJ') this.actions.push('attack');
    if (code === 'KeyK') this.actions.push('defend');
    if (code === 'KeyH') this.actions.push('toggleHitboxes');
  }
  release(code) { this.held.delete(code); }
  get direction() { return Number(this.held.has('KeyD')) - Number(this.held.has('KeyA')); }
  consumeActions() { return this.actions.splice(0); }
  clear() { this.held.clear(); this.actions.length = 0; }
}
