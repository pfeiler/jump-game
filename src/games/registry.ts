import type { GameDefinition } from './types';

const games: GameDefinition[] = [];

export function registerGame(def: GameDefinition): void {
  if (games.some((g) => g.id === def.id)) throw new Error(`game ${def.id} already registered`);
  games.push(def);
}

export const listGames = (): readonly GameDefinition[] => games;
export const getGame = (id: string): GameDefinition | undefined => games.find((g) => g.id === id);
