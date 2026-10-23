const KEY = 'shojo-progress';
const progressKey = encounter => encounter === 'ghost' ? `${KEY}-ghost` : KEY;

export function loadProgress(storage, encounter = 'samurai') {
  try {
    const saved = JSON.parse((storage ?? globalThis.localStorage).getItem(progressKey(encounter)));
    const hardUnlocked = saved?.hardUnlocked === true;
    return { hardUnlocked, difficulty: hardUnlocked && saved?.difficulty === 'hard' ? 'hard' : 'normal' };
  } catch { return { hardUnlocked: false, difficulty: 'normal' }; }
}

export function saveProgress(progress, storage, encounter = 'samurai') {
  try {
    (storage ?? globalThis.localStorage).setItem(progressKey(encounter), JSON.stringify({
      hardUnlocked: progress.hardUnlocked === true,
      difficulty: progress.difficulty === 'hard' && progress.hardUnlocked ? 'hard' : 'normal',
    }));
    return true;
  } catch { return false; }
}
