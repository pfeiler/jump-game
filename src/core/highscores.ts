/** Local highscores (localStorage only, first name / initials, max 10 chars). */
export interface HighscoreEntry { name: string; score: number; date: string }

const KEY = (game: string) => `jumpgame.highscores.${game}`;
export const MAX_NAME = 10;

export function sanitizeName(name: string): string {
  return name.replace(/[^\p{L}\p{N} .\-]/gu, '').trim().slice(0, MAX_NAME);
}

export function loadScores(game: string): HighscoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY(game));
    const list = raw ? (JSON.parse(raw) as HighscoreEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveScore(game: string, entry: HighscoreEntry): number {
  const list = loadScores(game);
  const e = { ...entry, name: sanitizeName(entry.name) || '???' };
  list.push(e);
  list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 10);
  try { localStorage.setItem(KEY(game), JSON.stringify(top)); } catch { /* storage full / private mode */ }
  return top.indexOf(e);
}

export function isHighscore(game: string, score: number): boolean {
  const l = loadScores(game);
  return score > 0 && (l.length < 10 || score > l[l.length - 1].score);
}
