import { z } from 'zod';
import { type Manuscript, type ModelGateway, blockText } from '@quire/core';

export const BLURB_SOURCE_CHARS = 60_000;
export const BLURB_MAX_TOKENS = 1_500;
/** KDP description limit. */
export const DESCRIPTION_MAX_CHARS = 4_000;

const BlurbSchema = z.object({
  hook: z.string(),
  description: z.string().max(DESCRIPTION_MAX_CHARS),
  backCover: z.string(),
});
export type Blurb = z.infer<typeof BlurbSchema>;

const BLURB_SYSTEM = `You write retail copy for books. Given the opening of a manuscript, write:
- hook: one line, under 20 words, for the top of the description
- description: 150-250 words of Amazon description copy, short paragraphs, no spoilers past the first act, no superlatives about the book itself
- backCover: 120-160 words for the print back cover
Match the genre's conventions. Return only JSON: {"hook": "...", "description": "...", "backCover": "..."}.`;

export async function generateBlurb(manuscript: Manuscript, gateway: ModelGateway, model: string): Promise<Blurb> {
  const opening = manuscript.chapters
    .flatMap((chapter) => [`## ${chapter.title}`, ...chapter.blocks.map(blockText)])
    .join('\n')
    .slice(0, BLURB_SOURCE_CHARS);
  const completion = await gateway.complete({
    model,
    system: BLURB_SYSTEM,
    prompt: `Title: ${manuscript.title}\n\n${opening}`,
    maxTokens: BLURB_MAX_TOKENS,
    cacheSystem: false,
  });
  const start = completion.text.indexOf('{');
  const end = completion.text.lastIndexOf('}');
  const parsed = BlurbSchema.safeParse(JSON.parse(completion.text.slice(start, end + 1)));
  if (!parsed.success) throw new Error(`Model returned malformed copy: ${parsed.error.message}`);
  return parsed.data;
}
