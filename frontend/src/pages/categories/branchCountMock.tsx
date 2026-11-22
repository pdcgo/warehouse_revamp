import { createContext, useContext, type ReactNode } from "react";

import type { BranchCountOption } from "./productCounts";

// ⚠ STORYBOOK-ONLY MOCK of the owner's Q3 (own vs whole branch) — never mounted by the app. Live, no provider sits above
// the page, so `useBranchCountOption()` answers "A", the option the page is built with (productCounts.ts). The mock
// stories (stories/ProductCount.stories.tsx) wrap the page in it to draw B and C on the same tree. Deleted, with the
// option branches it feeds, once the owner answers.
const BranchCount = createContext<BranchCountOption>("A");

export function BranchCountMock({ option, children }: { option: BranchCountOption; children: ReactNode }) {
  return <BranchCount.Provider value={option}>{children}</BranchCount.Provider>;
}

export function useBranchCountOption(): BranchCountOption {
  return useContext(BranchCount);
}
