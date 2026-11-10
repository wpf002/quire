import type { Plan } from '@quire/db';

export interface PlanDefinition {
  id: Plan;
  name: string;
  monthlyCents: number;
  activeBooks: number;
  spendCapCentsDaily: number;
  trackedKeywordsPerBook: number;
}

// Prices are list prices for display. Checkout is not wired.
export const PLANS: Record<Plan, PlanDefinition> = {
  starter: { id: 'starter', name: 'Starter', monthlyCents: 0, activeBooks: 1, spendCapCentsDaily: 100, trackedKeywordsPerBook: 25 },
  author: { id: 'author', name: 'Author', monthlyCents: 1_900, activeBooks: 5, spendCapCentsDaily: 500, trackedKeywordsPerBook: 150 },
  press: { id: 'press', name: 'Press', monthlyCents: 4_900, activeBooks: 25, spendCapCentsDaily: 2_000, trackedKeywordsPerBook: 500 },
};
