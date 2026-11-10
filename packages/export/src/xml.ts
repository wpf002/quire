import type { Run } from '@quire/core';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function runsToXhtml(runs: Run[]): string {
  return runs
    .map((run) => {
      let html = escapeXml(run.text);
      if (run.em) html = `<em>${html}</em>`;
      if (run.strong) html = `<strong>${html}</strong>`;
      return html;
    })
    .join('');
}
