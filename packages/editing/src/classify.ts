import { countWords } from '@quire/core';
import type { AiRole } from './types';

/** New words beyond this count mean the model wrote prose, which KDP calls AI-generated. */
export const GENERATED_NEW_WORDS_THRESHOLD = 25;

export function classifyModelEdit(before: string, after: string): AiRole {
  const beforeWords = new Set(before.toLowerCase().match(/[\p{L}’']+/gu) ?? []);
  const newWords = (after.toLowerCase().match(/[\p{L}’']+/gu) ?? []).filter((word) => !beforeWords.has(word));
  const grewSubstantially = countWords(after) > countWords(before) * 2 && countWords(after) - countWords(before) > 10;
  return newWords.length > GENERATED_NEW_WORDS_THRESHOLD || grewSubstantially ? 'generated' : 'assisted';
}
