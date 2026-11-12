import { describe, expect, it } from 'vitest';
import type { Manuscript, ModelGateway } from '@quire/core';
import { generateBlurb } from '../src';

const manuscript: Manuscript = {
  title: 'T',
  author: 'A',
  chapters: [{ id: 'c1', title: 'One', blocks: [{ kind: 'paragraph', id: 'p1', runs: [{ text: 'Pearl unlocked the bakery at five.' }] }] }],
};

function replying(text: string): ModelGateway {
  return {
    available: true,
    async complete() {
      return { model: 'claude-haiku-5-5', tokens: { input: 10, output: 10 }, text };
    },
  };
}

describe('generateBlurb', () => {
  // Regression: thinking used up the token budget, the JSON was cut off, and the author saw "Unexpected end of JSON input".
  it('reports a cut-off reply as an incomplete blurb', async () => {
    await expect(generateBlurb(manuscript, replying('{"hook": "Eleven years of early'), 'm')).rejects.toThrow('Model returned no blurb. Try again.');
    await expect(generateBlurb(manuscript, replying('{"hook": "x", "description": "y} more'), 'm')).rejects.toThrow('Model returned an incomplete blurb. Try again.');
  });

  it('parses a complete reply', async () => {
    const blurb = await generateBlurb(manuscript, replying('{"hook": "h", "description": "d", "backCover": "b"}'), 'm');
    expect(blurb).toEqual({ hook: 'h', description: 'd', backCover: 'b' });
  });
});
