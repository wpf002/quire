// The book pipeline, in order. The UI's progress strip and the API's state checks both read this.
export const BOOK_STAGES = ['upload', 'edit', 'comply', 'metadata', 'export', 'publish', 'track'] as const;
export type BookStage = (typeof BOOK_STAGES)[number];

export const PASS_KINDS = ['copyedit', 'proofread', 'structural'] as const;
export type PassKind = (typeof PASS_KINDS)[number];

export const TRIM_SIZES = {
  '5x8': { widthIn: 5, heightIn: 8, label: '5 × 8 in' },
  '5.5x8.5': { widthIn: 5.5, heightIn: 8.5, label: '5.5 × 8.5 in' },
  '6x9': { widthIn: 6, heightIn: 9, label: '6 × 9 in' },
} as const;
export type TrimSize = keyof typeof TRIM_SIZES;

export const EXPORT_TARGETS = ['kdp', 'ingramspark'] as const;
export type ExportTarget = (typeof EXPORT_TARGETS)[number];
