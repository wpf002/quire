import { AmazonAutocompleteProvider } from './amazon';
import type { DiscoveryProviders, KeywordSuggestionProvider } from './providers';
import { SampleCategoryProvider, SampleMarketProvider, SampleSuggestionProvider } from './sample';

const SUGGESTION_PROVIDERS: Record<string, () => KeywordSuggestionProvider> = {
  amazon: () => new AmazonAutocompleteProvider(),
  sample: () => new SampleSuggestionProvider(),
};

/** Build providers from QUIRE_DISCOVERY_PROVIDERS, e.g. "amazon,sample". First entry supplies suggestions. */
export function providersFromConfig(list: string[]): DiscoveryProviders {
  const name = list.find((entry) => entry in SUGGESTION_PROVIDERS) ?? 'sample';
  const factory = SUGGESTION_PROVIDERS[name] ?? SUGGESTION_PROVIDERS.sample!;
  return { suggestions: factory(), market: new SampleMarketProvider(), categories: new SampleCategoryProvider() };
}
