'use client';

import { createContext, useContext } from 'react';
import type { BookDetail } from '@/lib/types';

export type TabId = 'manuscript' | 'edits' | 'compliance' | 'metadata' | 'export' | 'rank';

export interface WorkspaceValue {
  bookId: string;
  detail: BookDetail;
  reload: () => Promise<void>;
  goTo: (tab: TabId) => void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside the book workspace');
  return value;
}
