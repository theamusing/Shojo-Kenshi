import { loadSprites } from './animations.js';
import { Actor } from './actor.js';
import { GAME_KEYS, KeyboardInput } from './input.js';
import { drawHitboxes } from './combat.js';
import { drawHitBursts, drawHitEmissionRings } from './hit-effects.js';
import { Duel, FINISHER } from './duel.js';
import { loadProgress, saveProgress } from './progress.js';
import { GameAudio } from './audio.js';
import { GROUND_Y, createStage, drawStage } from './stage.js';

const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const actors = { player: new Actor('player', 260, GROUND_Y), boss: new Actor('boss', 704, GROUND_Y, -1) };
const background = createStage(), keyboard = new KeyboardInput(), touches = new Map();
const scene = document.createElement('canvas'); scene.width = 960; scene.height = 540;
const finisherScene = document.createElement('canvas'); finisherScene.width = 960; finisherScene.height = 540;
const finisherContext = finisherScene.getContext('2d');
const sceneContext = scene.getContext('2d'), reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const drawOrder = [actors.boss, actors.player];
const sound = new GameAudio();
export const duel = new Duel(actors.player, actors.boss, { audio: sound, ...loadProgress(), onUnlock: saveProgress });
let lastTime = null, worldTime = 0, showHitboxes = false, ready = false, lastPhase = '';
const isEditing = target => target instanceof Element && !!target.closest('input, select, textarea');

function updateAudioControls() {
  $('music-volume').value = Math.round(sound.musicVolume * 100);
  $('effects-volume').value = Math.round(sound.effectsVolume * 100);
  $('audio-mute').textContent = sound.muted ? '开启声音' : '静音';
  $('audio-mute').setAttribute('aria-pressed', String(sound.muted));
}
function saveAudioSettings() {
  try { localStorage.setItem('shojo-audio', JSON.stringify({ music: sound.musicVolume, effects: sound.effectsVolume, muted: sound.muted })); } catch {}
}
try {
  const settings = JSON.parse(localStorage.getItem('shojo-audio'));
  if (settings && Number.isFinite(settings.music) && Number.isFinite(settings.effects)) sound.setVolumes(settings.music, settings.effects);
  if (typeof settings?.muted === 'boolean') sound.setMuted(settings.muted);
} catch {}
updateAudioControls();
async function unlockAudio() { await sound.start(); }
for (const id of ['music-volume', 'effects-volume']) $(id).addEventListener('input', () => {
  sound.setVolumes(Number($('music-volume').value) / 100, Number($('effects-volume').value) / 100);
  saveAudioSettings();
});
$('audio-mute').addEventListener('click', () => {
  sound.setMuted(!sound.muted); updateAudioControls(); saveAudioSettings();
});
function clearInput() { keyboard.clear(); touches.clear(); }
function updateDifficultySettings() {
  $('hard-option').disabled = !duel.hardUnlocked;
  $('hard-option').textContent = duel.hardUnlocked ? '困难' : '困难 · 尚未解锁';
  $('difficulty-select').value = duel.difficulty;
  $('difficulty-hint').textContent = duel.hardUnlocked ? '困难模式已解锁' : '击败红盔武士解锁困难模式';
}
function setGamePaused(paused) {
  duel.setPaused(paused); clearInput(); lastTime = null;
  $('pause-overlay').hidden = !paused;
  $('touch-controls').inert = paused;
  if (paused) { updateDifficultySettings(); $('continue-game').focus(); }
  else { canvas.focus(); unlockAudio(); }
}
function reset(difficulty = duel.difficulty) {
  if (!duel.reset(difficulty)) return;
  clearInput(); saveProgress(duel); worldTime = 0; lastTime = null; lastPhase = '';
  $('pause-overlay').hidden = true; $('touch-controls').inert = false;
  updateHUD(); canvas.focus(); unlockAudio();
}
window.addEventListener('keydown', event => {
  if (!ready || event.ctrlKey || event.metaKey || event.altKey) return;
  if (duel.canRestart && !event.repeat) {
    // Let victory buttons retain keyboard activation and Tab navigation.
    if (duel.phase === 'won' && (event.code === 'Tab'
      || (event.target.closest?.('button') && ['Enter', 'Space'].includes(event.code)))) return;
    event.preventDefault(); reset(); return;
  }
  if (event.code === 'Escape') {
    event.preventDefault();
    if (!event.repeat) setGamePaused(!duel.paused);
    return;
  }
  if (duel.paused || duel.phase !== 'playing' || isEditing(event.target)) return;
  if (!GAME_KEYS.has(event.code)) return;
  event.preventDefault();
  if (!event.repeat) unlockAudio();
  keyboard.press(event.code, event.repeat);
});
window.addEventListener('keyup', event => keyboard.release(event.code));
window.addEventListener('blur', clearInput);
window.addEventListener('pointerdown', event => {
  if (!ready) return;
  if (duel.phase === 'dead' || (duel.phase === 'won' && event.target.closest('#victory-restart'))) {
    event.preventDefault(); event.stopImmediatePropagation(); reset(); return;
  }
  unlockAudio();
}, true);
canvas.addEventListener('pointerdown', () => canvas.focus());
for (const button of document.querySelectorAll('[data-move]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (!ready || duel.paused || duel.phase !== 'playing') return;
    button.setPointerCapture(event.pointerId); touches.set(event.pointerId, Number(button.dataset.move));
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, event => touches.delete(event.pointerId));
}
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('pointerdown', event => {
  event.preventDefault();
  if (ready && !duel.paused && duel.phase === 'playing') keyboard.actions.push(button.dataset.action);
});
$('pause-button').addEventListener('click', () => { if (ready && !duel.canRestart) setGamePaused(!duel.paused); });
$('continue-game').addEventListener('click', () => setGamePaused(false));
$('restart-game').addEventListener('click', () => reset($('difficulty-select').value));
$('challenge-hard').addEventListener('click', () => reset('hard'));
// Keyboard-generated button clicks are supported as well as pointer input.
$('victory-restart').addEventListener('click', () => { if (duel.canRestart) reset(); });
$('death-restart').addEventListener('click', () => { if (duel.canRestart) reset(); });
function visibility() { clearInput(); lastTime = null; sound.setHidden(document.hidden); }
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pagehide', () => sound.setHidden(true));
window.addEventListener('pageshow', visibility);
sound.setHidden(document.hidden);

function updateHUD() {
  for (const [id, actor] of [['player', actors.player], ['boss', actors.boss]]) {
    $(`${id}-health-fill`).style.transform = `scaleX(${actor.health / actor.maxHealth})`;
    $(`${id}-health`).setAttribute('aria-valuenow', String(actor.health));
    $(`${id}-health`).setAttribute('aria-valuemax', String(actor.maxHealth));
  }
  $('boss-posture-fill').style.transform = `scaleX(${actors.boss.posture / actors.boss.maxPosture})`;
  $('boss-posture').setAttribute('aria-valuemax', String(actors.boss.maxPosture));
  $('difficulty-badge').hidden = duel.difficulty !== 'hard';
  $('boss-posture').setAttribute('aria-valuenow', String(Math.round(actors.boss.posture)));
  document.querySelector('.boss-hud').classList.toggle('broken', actors.boss.machine.current === 'down');
  $('instructions').hidden = duel.introRemaining <= 0 || duel.phase !== 'playing';
  $('instructions').style.opacity = Math.min(1, duel.introRemaining / .4);
  $('instructions').style.left = `${Math.max(22, Math.min(78, actors.player.x / 960 * 100))}%`;
  $('stage').classList.toggle('dying', duel.phase === 'dying' || duel.phase === 'dead');
  $('stage').classList.toggle('finishing', duel.finisherActive);
  $('death-overlay').hidden = duel.phase !== 'dead';
  $('victory-overlay').hidden = duel.phase !== 'won';
  $('pause-button').hidden = duel.canRestart;
  $('touch-controls').hidden = duel.phase !== 'playing';
  $('audio-status').hidden = !sound.error;
  $('audio-status').textContent = sound.error;
  if (lastPhase !== duel.phase) {
    if (duel.phase !== 'playing') clearInput();
    if (duel.phase === 'dead') $('death-restart').focus();
    if (duel.phase === 'won') {
      const seconds = Math.floor(duel.elapsed);
      $('result-time').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      $('result-flawless').textContent = duel.noDamage ? '是 · 一伤未受' : '否 · 浴血取胜';
      $('unlock-message').hidden = !duel.newUnlock;
      $('challenge-hard').hidden = !duel.hardUnlocked || duel.difficulty === 'hard';
      $('victory-restart').focus();
    }
    lastPhase = duel.phase;
  }
}
updateHUD();
try {
  const images = await loadSprites();
  $('loading').hidden = true; ready = true;
  function frame(now) {
    const dt = lastTime === null || document.hidden ? 0 : Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    if (!duel.paused && !duel.canRestart) worldTime += dt * (duel.phase === 'dying' ? .25 : duel.finisherActive ? FINISHER.speed : 1);
    const touchDirection = [...touches.values()].reduce((a, b) => a + b, 0);
    const actions = keyboard.consumeActions();
    if (actions.includes('toggleHitboxes')) showHitboxes = !showHitboxes;
    duel.update(dt, Math.sign(keyboard.direction + touchDirection), actions.filter(action => action !== 'toggleHitboxes'));
    drawStage(sceneContext, background, worldTime, Object.values(actors), false);
    for (const actor of drawOrder) actor.draw(sceneContext, images);
    duel.effects.draw(sceneContext, { showHits: !duel.finisherActive });
    if (showHitboxes) {
      drawHitboxes(sceneContext, drawOrder);
      drawHitEmissionRings(sceneContext, drawOrder);
    }
    const shake = reducedMotion.matches ? { x: 0, y: 0 } : duel.effects.cameraOffset;
    ctx.fillStyle = '#172a30'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(shake.x, shake.y); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scene, 0, 0); duel.effects.drawRipples(ctx, scene); ctx.restore();
    if (duel.finisherActive) {
      finisherContext.fillStyle = '#fff'; finisherContext.fillRect(0, 0, 960, 540);
      for (const actor of drawOrder) actor.draw(finisherContext, images, false, { silhouette: true });
      ctx.save(); ctx.globalAlpha = duel.finisherOpacity; ctx.drawImage(finisherScene, 0, 0); ctx.restore();
      drawHitBursts(ctx, duel.effects.hits, '#999999');
    }
    updateHUD();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
} catch (error) {
  $('loading').textContent = `${error.message}。请通过 npm run dev 打开游戏。`;
  console.error(error);
}
