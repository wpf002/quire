import { type HTMLElement, type Node, NodeType, parse } from 'node-html-parser';
import type { Run } from '@quire/core';
import type { ManuscriptBuilder } from './builder';

const HEADING_TAGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 3, H5: 3, H6: 3 };
const EMPHASIS_TAGS = new Set(['EM', 'I', 'CITE']);
const STRONG_TAGS = new Set(['STRONG', 'B']);
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'HEAD', 'TITLE', 'SVG', 'IMG', 'FIGURE', 'TABLE']);

/** Walks sanitized HTML (from mammoth or epub xhtml) into the builder. Never evaluates markup. */
export function feedHtml(html: string, builder: ManuscriptBuilder): void {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, pre: true } });
  const body = root.querySelector('body') ?? root;
  if (body.querySelectorAll('h1').length > 0) builder.markLevelOneChapters();
  walkBlocks(body, builder);
}

function walkBlocks(element: HTMLElement, builder: ManuscriptBuilder): void {
  for (const child of element.childNodes) {
    if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
    const node = child as HTMLElement;
    const tag = node.tagName;
    if (SKIP_TAGS.has(tag)) continue;
    const headingLevel = HEADING_TAGS[tag];
    if (headingLevel !== undefined) {
      builder.addHeading(headingLevel, collectRuns(node));
    } else if (tag === 'P' || tag === 'LI') {
      builder.addParagraph(collectRuns(node));
    } else if (tag === 'BLOCKQUOTE') {
      const paragraphs = node.querySelectorAll('p');
      if (paragraphs.length === 0) builder.addParagraph(collectRuns(node), 'quote');
      for (const paragraph of paragraphs) builder.addParagraph(collectRuns(paragraph), 'quote');
    } else if (tag === 'HR') {
      builder.addSceneBreak();
    } else {
      walkBlocks(node, builder);
    }
  }
}

function collectRuns(element: HTMLElement): Run[] {
  const runs: Run[] = [];
  const visit = (node: Node, em: boolean, strong: boolean) => {
    if (node.nodeType === NodeType.TEXT_NODE) {
      runs.push({ text: decodeEntities(node.rawText), ...(em ? { em } : {}), ...(strong ? { strong } : {}) });
      return;
    }
    if (node.nodeType !== NodeType.ELEMENT_NODE) return;
    const tag = (node as HTMLElement).tagName;
    if (SKIP_TAGS.has(tag)) return;
    if (tag === 'BR') {
      runs.push({ text: ' ' });
      return;
    }
    for (const child of node.childNodes) visit(child, em || EMPHASIS_TAGS.has(tag), strong || STRONG_TAGS.has(tag));
  };
  for (const child of element.childNodes) visit(child, false, false);
  return runs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}
