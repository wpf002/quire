import type { Manuscript, ModelGateway, PassKind } from '@quire/core';
import { SpendCapError } from '@quire/core';
import { applyRules, COPYEDIT_RULES, PROOFREAD_RULES } from './rules';
import { modelLineEdits, modelStructuralNotes } from './model';
import type { AiRole, EditProposal, PassResult, StructuralNote } from './types';

export interface PassModels {
  cheap: string;
  structural: string;
}

export async function runPass(
  kind: PassKind,
  manuscript: Manuscript,
  gateway: ModelGateway,
  models: PassModels,
): Promise<PassResult> {
  const rules = kind === 'copyedit' ? COPYEDIT_RULES : kind === 'proofread' ? PROOFREAD_RULES : [];
  const ruled = applyRules(manuscript, rules);
  let modelEdits: EditProposal[] = [];
  let notes: StructuralNote[] = [];
  let model: string | null = null;
  let modelSkippedReason: string | null = null;

  if (!gateway.available) {
    modelSkippedReason = 'No model key configured';
  } else {
    try {
      if (kind === 'structural') {
        model = models.structural;
        notes = await modelStructuralNotes(manuscript, gateway, { model });
      } else {
        model = models.cheap;
        modelEdits = await modelLineEdits(manuscript, gateway, { model, kind });
      }
    } catch (error) {
      if (!(error instanceof SpendCapError)) throw error;
      modelSkippedReason = error.message;
      model = null;
    }
  }

  const edits = mergeEdits(ruled.edits, modelEdits);
  const aiRole: AiRole = edits.some((edit) => edit.aiRole === 'generated')
    ? 'generated'
    : model !== null
      ? 'assisted'
      : 'none';
  return {
    kind,
    model,
    edits,
    notes,
    modelSkippedReason,
    touch: { pass: kind, model, blocksExamined: ruled.blocksExamined, editsProposed: edits.length, aiRole },
  };
}

/** Rule edits win where both touch the same fragment: they're deterministic and free. */
function mergeEdits(ruleEdits: EditProposal[], modelEdits: EditProposal[]): EditProposal[] {
  const ruled = new Set(ruleEdits.map((edit) => `${edit.blockId}:${edit.before}`));
  return [...ruleEdits, ...modelEdits.filter((edit) => !ruled.has(`${edit.blockId}:${edit.before}`))];
}
