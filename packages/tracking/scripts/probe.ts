// Live check of the Amazon page provider: pnpm --filter @quire/tracking run probe <ASIN> "keyword" ["keyword" ...]
import { AmazonPageRankProvider } from '../src';

async function main(): Promise<void> {
  const [asin, ...keywords] = process.argv.slice(2);
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) throw new Error('usage: probe <ASIN> "keyword" ["keyword" ...]');
  const metadata = { bookId: 'probe', asin, title: '', keywordBoxes: [], categories: [], appliedAt: new Date() };
  const started = Date.now();
  const snapshot = await new AmazonPageRankProvider().observe(metadata, keywords, new Date());
  console.log(JSON.stringify({ ...snapshot, seconds: Math.round((Date.now() - started) / 1000) }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
