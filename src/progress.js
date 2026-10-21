const KEY = 'shojo-progress';

export function loadProgress(storage) {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(KEY));
    const hardUnlocked = saved?.hardUnlocked === true;
    return { hardUnlocked, difficulty: hardUnlocked && saved?.difficulty === 'hard' ? 'hard' : 'normal' };
  } catch { return { hardUnlocked: false, difficulty: 'normal' }; }
}

export function saveProgress(progress, storage) {
  try {
    (storage ?? globalThis.localStorage).setItem(KEY, JSON.stringify({
      hardUnlocked: progress.hardUnlocked === true,
      difficulty: progress.difficulty === 'hard' && progress.hardUnlocked ? 'hard' : 'normal',
    }));
    return true;
  } catch { return false; }
}
