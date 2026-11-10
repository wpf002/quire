import { BOOK_STAGES, type BookStage } from '@quire/core/stages';

export const STAGE_LABELS: Record<BookStage, string> = {
  upload: 'Upload',
  edit: 'Edit',
  comply: 'Comply',
  metadata: 'Metadata',
  export: 'Export',
  publish: 'Publish',
  track: 'Track',
};

export function stageIndex(stage: BookStage): number {
  return BOOK_STAGES.indexOf(stage);
}

/** Seven ticks: finished stages in ink, the current one in oxblood. */
export function StageStrip({ stage }: { stage: BookStage }) {
  const current = stageIndex(stage);
  return (
    <div className="stage-strip" role="img" aria-label={`Stage ${current + 1} of ${BOOK_STAGES.length}: ${STAGE_LABELS[stage]}`}>
      {BOOK_STAGES.map((name, index) => (
        <span key={name} className={index < current ? 'done' : index === current ? 'current' : undefined} />
      ))}
    </div>
  );
}
