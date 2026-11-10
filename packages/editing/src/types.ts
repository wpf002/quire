import type { PassKind } from '@quire/core';

export type EditSource = 'rule' | 'model';
/** KDP's terms: assisted = the author's text, refined; generated = new text the tool wrote. */
export type AiRole = 'none' | 'assisted' | 'generated';

export interface EditProposal {
  chapterId: string;
  blockId: string;
  before: string;
  after: string;
  reason: string;
  rule: string | null;
  source: EditSource;
  aiRole: AiRole;
}

export interface StructuralNote {
  chapterId: string | null;
  note: string;
  /** Specific notes quote the manuscript; the quote is verified. Everything else is labeled generic. */
  specificity: 'specific' | 'generic';
  quote: string | null;
}

export interface ContentTouch {
  pass: PassKind;
  model: string | null;
  blocksExamined: number;
  editsProposed: number;
  aiRole: AiRole;
}

export interface PassResult {
  kind: PassKind;
  model: string | null;
  edits: EditProposal[];
  notes: StructuralNote[];
  touch: ContentTouch;
  /** Set when the model path was skipped and only rules ran. */
  modelSkippedReason: string | null;
}
