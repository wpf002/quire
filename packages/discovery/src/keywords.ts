import type { KeywordMarket, KeywordSuggestionProvider, Storefront } from './providers';
import { estimateDailySales } from './sales';

export interface KeywordScore {
  keyword: string;
  /** 0–1. How readily Amazon suggests the phrase: shown at a shorter prefix means more shoppers type it. */
  demand: number;
  /** 0–1. Higher means stronger books already rank for it. */
  competition: number;
  score: number;
  resultCount: number | null;
  topSalesPerDay: number | null;
  source: string;
}

const MIN_PREFIX = 3;
const MAX_PREFIX_STEPS = 5;
const SATURATED_RESULT_COUNT = 50_000;
const STRONG_COMPETITOR_SALES = 60;
/** Median ratings of the top results at which a keyword counts as fully contested. */
const STRONG_COMPETITOR_REVIEWS = 1_000;
const NEUTRAL_STRENGTH = 0.5;

/** Find the shortest prefix at which Amazon suggests the keyword. */
export async function demandScore(keyword: string, provider: KeywordSuggestionProvider, storefront: Storefront): Promise<number> {
  const normalized = keyword.toLowerCase().trim();
  const lengths = prefixLengths(normalized.length);
  for (const [index, length] of lengths.entries()) {
    const { suggestions } = await provider.suggest(normalized.slice(0, length), storefront);
    if (suggestions.includes(normalized)) return 1 - index / lengths.length;
  }
  return 0;
}

function prefixLengths(total: number): number[] {
  if (total <= MIN_PREFIX) return [total];
  const step = Math.max(1, Math.ceil((total - MIN_PREFIX) / (MAX_PREFIX_STEPS - 1)));
  const lengths: number[] = [];
  for (let length = MIN_PREFIX; length < total; length += step) lengths.push(length);
  lengths.push(total);
  return lengths;
}

/** Search pages carry ratings but no BSR, so ratings stand in for competitor strength there. */
function reviewStrength(market: KeywordMarket): number {
  const reviews = market.topTitles.map((title) => title.reviews).filter((count): count is number => count !== null);
  return reviews.length > 0 ? Math.min(1, median(reviews) / STRONG_COMPETITOR_REVIEWS) : NEUTRAL_STRENGTH;
}

export function competitionScore(market: KeywordMarket): { competition: number; topSalesPerDay: number | null } {
  const ranked = market.topTitles.map((title) => title.bsr).filter((bsr): bsr is number => bsr !== null);
  const topSalesPerDay = ranked.length > 0 ? median(ranked.map(estimateDailySales)) : null;
  const strength = topSalesPerDay === null ? reviewStrength(market) : Math.min(1, topSalesPerDay / STRONG_COMPETITOR_SALES);
  const crowding = market.resultCount === null ? 0.5 : Math.min(1, Math.log10(Math.max(1, market.resultCount)) / Math.log10(SATURATED_RESULT_COUNT));
  return { competition: 0.6 * strength + 0.4 * crowding, topSalesPerDay };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function combineScore(demand: number, competition: number): number {
  return Math.round(100 * demand * (1 - 0.7 * competition)) / 100;
}

/** Amazon autocomplete returns little for long phrases, so each seed also tries its last two words. */
const BACKOFF_WORDS = 2;
/** "cozy mystery a" … "cozy mystery z" surfaces the long tail that a bare prefix hides. */
const SUFFIXES = [' ', ...'abcdefghijklmnopqrstuvwxyz'.split('').map((letter) => ` ${letter}`)];
/** Longer suggestions are almost always book titles, not search phrases. */
const MAX_KEYWORD_WORDS = 6;
/** Suggestions that describe a different product than one paid book. */
const OFF_PRODUCT_PATTERN = /\b(free|dvd|box(es|ed)?( sets?)?|bundles?|mega set|book \d+|\d+-book|paperbacks?|prime reading|(kindle )?unlimited|top \d+|word search(es)?|puzzles?|games?|kits?|coloring|audiobooks?|audible|young adult|ya|for (kids|teens)|\d+-\d+|\d{4}|[a-z]+\d+)\b/;
/** Autocomplete also returns store labels ("cozy mystery kindle+"). Search phrases hold only words. */
const SEARCH_PHRASE_PATTERN = /^[\p{L}\p{N}\s'’&-]+$/u;

export function isUsableKeyword(phrase: string): boolean {
  return phrase.split(/\s+/).length <= MAX_KEYWORD_WORDS && SEARCH_PHRASE_PATTERN.test(phrase) && !OFF_PRODUCT_PATTERN.test(phrase);
}

function normalizeName(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** KDP rejects other authors' names in keywords. Names come from the bylines of each keyword's top results. */
export function namesAnAuthor(keyword: string, authors: Iterable<string>): boolean {
  const phrase = ` ${normalizeName(keyword)} `;
  for (const author of authors) {
    const name = normalizeName(author);
    if (name.includes(' ') && phrase.includes(` ${name} `)) return true;
  }
  return false;
}

/** Words that say what kind of book it is, not which series. */
const GENERIC_WORDS = new Set(['a', 'an', 'the', 'and', 'of', 'in', 'with', 'cozy', 'mystery', 'mysteries', 'series', 'book', 'books', 'novel', 'novels']);
/** One distinctive word ("quilting") is a theme. Two or more that match a series tag ("ivy creek") are a series name. */
const MIN_SERIES_NAME_WORDS = 2;

function distinctiveWords(text: string): string {
  return normalizeName(text)
    .split(' ')
    .filter((word) => word && !GENERIC_WORDS.has(word))
    .join(' ');
}

/** Names from result titles: the title itself, "(A Lexy Baker Cozy Mystery Book 3)" and "Title: Ivy Creek Cozy Mystery Book 5". */
export function titleTags(titles: Iterable<string>): string[] {
  const tags: string[] = [];
  for (const title of titles) {
    for (const match of title.matchAll(/\(([^)]+)\)/g)) tags.push(match[1]!);
    const withoutSeries = title.replace(/\([^)]*\)/g, '');
    const colon = withoutSeries.indexOf(':');
    tags.push(colon >= 0 ? withoutSeries.slice(0, colon) : withoutSeries);
    if (colon >= 0) tags.push(withoutSeries.slice(colon + 1));
  }
  return tags;
}

/** Lowercase words with a plain plural stripped, so "Mysteries" matches "mystery". */
export function topicWords(text: string): Set<string> {
  return new Set(stemmedWords(text));
}

function stemmedWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2)
    .map((word) => word.replace(/ies$/, 'y').replace(/s$/, ''));
}

/** A novel uses most common words in passing. A topic comes up at least once per this many words. */
const WORDS_PER_TOPIC_MENTION = 5_000;

export interface BookTopics {
  mentions: Map<string, number>;
  /** Mentions a word needs before the book counts as being about it. */
  minMentions: number;
}

export function bookTopics(bookText: string): BookTopics {
  const mentions = new Map<string, number>();
  for (const word of stemmedWords(bookText)) mentions.set(word, (mentions.get(word) ?? 0) + 1);
  return { mentions, minMentions: Math.max(1, Math.ceil(bookText.split(/\s+/).length / WORDS_PER_TOPIC_MENTION)) };
}

/** Words that appear in any seed but say nothing about the niche. */
const NICHE_STOP_WORDS = topicWords('the and for with book series novel fiction');

/** Seed words beyond the genre ("cozy", "bakery"). Empty when the seeds only restate the genre. */
export function nicheWords(seeds: string[], genre: string): Set<string> {
  const genreWords = topicWords(genre);
  return new Set([...topicWords(seeds.join(' '))].filter((word) => !genreWords.has(word) && !NICHE_STOP_WORDS.has(word)));
}

/** Listing words that say how the book is sold, never what it is about. */
const LISTING_WORDS = topicWords('series set collection box kindle ebook paperback audiobook unlimited free new best read adult');

/**
 * Autocomplete pairs a niche with topics the book may not have ("cozy mystery horses").
 * A phrase describes the book when each word beyond the book's own words and listing words is a topic of the manuscript.
 */
export function describesBook(phrase: string, ownWords: Set<string>, book: BookTopics): boolean {
  return [...topicWords(phrase)].every(
    (word) => ownWords.has(word) || (book.mentions.get(word) ?? 0) >= book.minMentions || NICHE_STOP_WORDS.has(word) || LISTING_WORDS.has(word),
  );
}

/** A phrase fits the niche when it shares a niche word. With no niche words every phrase fits. */
export function fitsNiche(phrase: string, niche: Set<string>): boolean {
  if (niche.size === 0) return true;
  return [...topicWords(phrase)].some((word) => niche.has(word));
}

/** KDP rejects other books' titles, series and character names in keywords. A phrase made only of the book's own seed words is never a foreign name. */
export function namesASeries(keyword: string, tags: Iterable<string>, ownWords: Iterable<string> = []): boolean {
  const name = distinctiveWords(keyword);
  const nameWords = name.split(' ').filter(Boolean);
  if (nameWords.length < MIN_SERIES_NAME_WORDS) return false;
  const own = new Set([...ownWords].flatMap((phrase) => normalizeName(phrase).split(' ')));
  if (nameWords.every((word) => own.has(word))) return false;
  for (const tag of tags) if (` ${distinctiveWords(tag)} `.includes(` ${name} `)) return true;
  return false;
}

/** A three-word seed ("cozy bakery mystery") also expands its outer pair ("cozy mystery"), which autocompletes to far more niche phrases. */
const OUTER_PAIR_WORDS = 3;

/** Phrases to expand: each seed, its two-word tail, the outer pair of a three-word seed, then the genre. Duplicates drop out. */
export function expansionPhrases(seeds: string[], genre: string | null): string[] {
  const phrases: string[] = [];
  for (const seed of [...seeds, genre ?? '']) {
    const normalized = seed.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!normalized) continue;
    const words = normalized.split(' ');
    phrases.push(normalized);
    if (words.length > BACKOFF_WORDS) phrases.push(words.slice(-BACKOFF_WORDS).join(' '));
    if (words.length === OUTER_PAIR_WORDS) phrases.push(`${words[0]} ${words[2]}`);
  }
  return [...new Set(phrases)];
}

/**
 * Expand seed phrases into candidate keywords using the suggestion provider.
 * Candidates interleave across phrases so one broad phrase can't fill the whole limit.
 */
export async function expandSeeds(
  seeds: string[],
  provider: KeywordSuggestionProvider,
  storefront: Storefront,
  limit: number,
  genre: string | null = null,
): Promise<string[]> {
  const perPhrase: string[][] = [];
  for (const phrase of expansionPhrases(seeds, genre)) {
    const found = new Set<string>([phrase]);
    for (const suffix of SUFFIXES) {
      const { suggestions } = await provider.suggest(`${phrase}${suffix}`, storefront);
      for (const suggestion of suggestions) if (isUsableKeyword(suggestion)) found.add(suggestion);
    }
    perPhrase.push([...found]);
  }
  const candidates = new Set<string>();
  for (let index = 0; candidates.size < limit && perPhrase.some((list) => index < list.length); index += 1) {
    for (const list of perPhrase) if (index < list.length && candidates.size < limit) candidates.add(list[index]!);
  }
  return [...candidates];
}
