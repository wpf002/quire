export interface DiffPart {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

const TOKEN = /\s+|[^\s\w]|\w+/g;

/** Word-level diff via longest common subsequence. Fine for paragraph-sized edits. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const left = before.match(TOKEN) ?? [];
  const right = after.match(TOKEN) ?? [];
  const lengths: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i]![j] = left[i] === right[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = parts.at(-1);
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      push('same', left[i]!);
      i += 1;
      j += 1;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      push('removed', left[i]!);
      i += 1;
    } else {
      push('added', right[j]!);
      j += 1;
    }
  }
  while (i < left.length) push('removed', left[i++]!);
  while (j < right.length) push('added', right[j++]!);
  return parts;
}
