import { Lexer, type Token, type Tokens } from 'marked';
import type { Manuscript, Run } from '@quire/core';
import { ManuscriptBuilder } from './builder';
import { decodeEntities } from './html';

export function ingestMarkdown(source: string, fallbackTitle: string): Manuscript {
  const tokens = Lexer.lex(source);
  const builder = new ManuscriptBuilder(fallbackTitle);
  if (tokens.some((token) => token.type === 'heading' && token.depth === 1)) builder.markLevelOneChapters();
  for (const token of tokens) feedToken(token, builder);
  return builder.build({});
}

function feedToken(token: Token, builder: ManuscriptBuilder): void {
  switch (token.type) {
    case 'heading':
      builder.addHeading(token.depth, inlineRuns(token.tokens ?? []));
      break;
    case 'paragraph':
      builder.addParagraph(inlineRuns(token.tokens ?? []));
      break;
    case 'blockquote':
      for (const child of token.tokens ?? []) {
        if (child.type === 'paragraph') builder.addParagraph(inlineRuns(child.tokens ?? []), 'quote');
      }
      break;
    case 'hr':
      builder.addSceneBreak();
      break;
    case 'list':
      for (const item of (token as Tokens.List).items) builder.addParagraph(inlineRuns(item.tokens));
      break;
    default:
      break;
  }
}

function inlineRuns(tokens: Token[], em = false, strong = false): Run[] {
  const runs: Run[] = [];
  for (const token of tokens) {
    if (token.type === 'em') runs.push(...inlineRuns(token.tokens ?? [], true, strong));
    else if (token.type === 'strong') runs.push(...inlineRuns(token.tokens ?? [], em, true));
    else if (token.type === 'text' && 'tokens' in token && token.tokens) runs.push(...inlineRuns(token.tokens, em, strong));
    else if (token.type === 'br') runs.push({ text: ' ' });
    else if ('text' in token && typeof token.text === 'string') {
      runs.push({ text: decodeEntities(token.text), ...(em ? { em } : {}), ...(strong ? { strong } : {}) });
    }
  }
  return runs;
}
