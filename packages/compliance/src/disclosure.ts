/**
 * KDP's AI content questions, as worded on the Content step of the title setup form.
 * KDP distinguishes AI-generated content (must be disclosed) from AI-assisted
 * content (edits, refinement, brainstorming on the author's own work; no disclosure).
 * Amazon changes this form. Re-check it against the live form and bump the date when it changes.
 */
export const KDP_FORM_VERIFIED_ON = '2026-11-10';

export const KDP_EXTENT_OPTIONS = [
  'Entire work, with minimal or no editing',
  'Entire work, with extensive editing',
  'Some sections, with minimal or no editing',
  'Some sections, with extensive editing',
] as const;
export type KdpExtent = (typeof KDP_EXTENT_OPTIONS)[number];

export type ContentCategory = 'text' | 'images' | 'translation';

/** One accepted change from the content-touch log. */
export interface AcceptedTouch {
  blockId: string;
  aiRole: 'none' | 'assisted' | 'generated';
  model: string | null;
  /** Words of AI-written text that ended up in the manuscript. */
  wordsAdded: number;
  /** The author rewrote the suggestion before accepting it. */
  authorRevised: boolean;
}

/** What the author tells us about work done outside Quire. */
export interface AuthorDeclaration {
  textGeneratedOutsideQuire: { used: boolean; extent: KdpExtent | null; tool: string | null };
  imagesGenerated: { used: boolean; extent: KdpExtent | null; tool: string | null };
  translationGenerated: { used: boolean; extent: KdpExtent | null; tool: string | null };
}

export interface CategoryAnswer {
  category: ContentCategory;
  question: string;
  answer: 'Yes' | 'No';
  extent: KdpExtent | null;
  tools: string[];
  basis: string;
}

export interface DisclosureReport {
  formVerifiedOn: string;
  answers: CategoryAnswer[];
  assistedEdits: number;
  generatedEdits: number;
  generatedWords: number;
  notes: string[];
}

// Above this share of the manuscript's words, AI text counts as the "entire work".
const ENTIRE_WORK_SHARE = 0.5;
// Under this share of generated suggestions left untouched, editing counts as "extensive".
const MINIMAL_EDITING_SHARE = 0.5;

const QUESTIONS: Record<ContentCategory, string> = {
  text: 'Did you use AI-based tools to create texts?',
  images: 'Did you use AI-based tools to create images?',
  translation: 'Did you use AI-based tools to translate?',
};

const TOOL_NAMES: Record<string, string> = {
  haiku: 'Claude (Anthropic)',
  sonnet: 'Claude (Anthropic)',
  opus: 'Claude (Anthropic)',
};

function toolName(model: string): string {
  const key = Object.keys(TOOL_NAMES).find((name) => model.includes(name));
  return key ? (TOOL_NAMES[key] ?? model) : model;
}

function textExtent(generated: AcceptedTouch[], manuscriptWords: number): KdpExtent {
  const words = generated.reduce((sum, touch) => sum + touch.wordsAdded, 0);
  const entire = manuscriptWords > 0 && words / manuscriptWords > ENTIRE_WORK_SHARE;
  const unrevised = generated.filter((touch) => !touch.authorRevised).length / generated.length;
  const minimal = unrevised >= MINIMAL_EDITING_SHARE;
  if (entire) return minimal ? 'Entire work, with minimal or no editing' : 'Entire work, with extensive editing';
  return minimal ? 'Some sections, with minimal or no editing' : 'Some sections, with extensive editing';
}

const EXTENT_RANK: Record<KdpExtent, number> = {
  'Some sections, with extensive editing': 0,
  'Some sections, with minimal or no editing': 1,
  'Entire work, with extensive editing': 2,
  'Entire work, with minimal or no editing': 3,
};

function broader(left: KdpExtent | null, right: KdpExtent | null): KdpExtent | null {
  if (!left) return right;
  if (!right) return left;
  return EXTENT_RANK[left] >= EXTENT_RANK[right] ? left : right;
}

export function buildDisclosureReport(touches: AcceptedTouch[], declaration: AuthorDeclaration, manuscriptWords: number): DisclosureReport {
  const assisted = touches.filter((touch) => touch.aiRole === 'assisted');
  const generated = touches.filter((touch) => touch.aiRole === 'generated');
  const generatedWords = generated.reduce((sum, touch) => sum + touch.wordsAdded, 0);

  const quireExtent = generated.length > 0 ? textExtent(generated, manuscriptWords) : null;
  const textTools = new Set(generated.flatMap((touch) => (touch.model ? [toolName(touch.model)] : [])));
  const outside = declaration.textGeneratedOutsideQuire;
  if (outside.used && outside.tool) textTools.add(outside.tool);
  const textExtentAnswer = broader(quireExtent, outside.used ? outside.extent : null);
  const textUsed = generated.length > 0 || outside.used;

  const answers: CategoryAnswer[] = [
    {
      category: 'text',
      question: QUESTIONS.text,
      answer: textUsed ? 'Yes' : 'No',
      extent: textUsed ? textExtentAnswer : null,
      tools: [...textTools],
      basis: textUsed
        ? `${generated.length} accepted AI-written passages (${generatedWords} words)${outside.used ? ', plus text you declared from outside Quire' : ''}`
        : `${assisted.length} AI-assisted edits only. KDP doesn't require disclosure for assisted edits.`,
    },
    declaredAnswer('images', declaration.imagesGenerated),
    declaredAnswer('translation', declaration.translationGenerated),
  ];

  const notes = [
    'Book descriptions and other metadata are not part of the content disclosure.',
    'Quire does not generate images or translations. Those answers come from your declaration.',
  ];
  return { formVerifiedOn: KDP_FORM_VERIFIED_ON, answers, assistedEdits: assisted.length, generatedEdits: generated.length, generatedWords, notes };
}

function declaredAnswer(category: ContentCategory, declared: AuthorDeclaration['imagesGenerated']): CategoryAnswer {
  return {
    category,
    question: QUESTIONS[category],
    answer: declared.used ? 'Yes' : 'No',
    extent: declared.used ? declared.extent : null,
    tools: declared.used && declared.tool ? [declared.tool] : [],
    basis: 'Your declaration',
  };
}
