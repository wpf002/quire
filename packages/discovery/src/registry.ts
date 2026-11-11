import { AmazonAutocompleteProvider, AmazonCategoryProvider, AmazonMarketProvider, PacedPageFetcher } from './amazon';
import type { DiscoveryProviders } from './providers';
import { SampleCategoryProvider, SampleMarketProvider, SampleSuggestionProvider } from './sample';

/**
 * Build providers from QUIRE_DISCOVERY_PROVIDERS. "amazon" reads live amazon.com for suggestions,
 * market and categories; anything else gets the deterministic sample providers.
 */
export function providersFromConfig(list: string[]): DiscoveryProviders {
  if (!list.includes('amazon')) {
    return { suggestions: new SampleSuggestionProvider(), market: new SampleMarketProvider(), categories: new SampleCategoryProvider() };
  }
  const pages = new PacedPageFetcher();
  return { suggestions: new AmazonAutocompleteProvider(), market: new AmazonMarketProvider(pages), categories: new AmazonCategoryProvider(pages) };
}
