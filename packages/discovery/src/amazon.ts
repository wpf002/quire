import { z } from 'zod';
import { getJson } from './http';
import type { KeywordSuggestionProvider, KeywordSuggestions, Storefront } from './providers';

// Amazon's public search-box autocomplete for amazon.com. Same data a shopper sees while typing.
const COMPLETION_URL = 'https://completion.amazon.com/api/2017/suggestions';
const US_MARKETPLACE = 'ATVPDKIKX0DER';
const ALIAS: Record<Storefront, string> = { kindle: 'digital-text', books: 'stripbooks' };

const CompletionSchema = z.object({
  suggestions: z.array(z.object({ value: z.string() })).default([]),
});

export class AmazonAutocompleteProvider implements KeywordSuggestionProvider {
  readonly name = 'amazon-autocomplete';

  async suggest(prefix: string, storefront: Storefront): Promise<KeywordSuggestions> {
    const params = new URLSearchParams({
      mid: US_MARKETPLACE,
      alias: ALIAS[storefront],
      prefix,
      'suggestion-type': 'KEYWORD',
      'page-type': 'Search',
      'lop': 'en_US',
      'site-variant': 'desktop',
      'client-info': 'amazon-search-ui',
    });
    const body = CompletionSchema.parse(await getJson(this.name, `${COMPLETION_URL}?${params}`));
    return { prefix, suggestions: body.suggestions.map((suggestion) => suggestion.value.toLowerCase().trim()).filter(Boolean) };
  }
}
