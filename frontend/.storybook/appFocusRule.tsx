import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Decorator } from "@storybook/react-vite";

import { queryClient as appQueryClient } from "../src/api/queryClient";

// THE APP'S FOCUS RULE, IN A STORY — `refetchOnWindowFocus: false` (src/api/queryClient.ts, HARD RULE 10), which
// preview.tsx's per-story QueryClient leaves at TanStack's default (`true`: every STALE query re-reads when the tab is
// shown again). A story about what a return to the tab re-reads (a-helper-link-opens-a-new-tab) needs the app's rule, or
// every always-fresh list re-reads on its own and a query's opt-in proves nothing.
//
// A decorator, inside preview's QueryClientProvider: it sets the rule on that story's client once, on its first render —
// before any query below it is built.
function AppFocusRule({ children }: { children: ReactNode }) {
  const client = useQueryClient();

  useState(() => {
    const defaults = client.getDefaultOptions();
    client.setDefaultOptions({
      ...defaults,
      queries: { ...defaults.queries, refetchOnWindowFocus: appQueryClient.getDefaultOptions().queries?.refetchOnWindowFocus },
    });
    return null;
  });

  return <>{children}</>;
}

export const withTheAppsFocusRule: Decorator = (Story) => (
  <AppFocusRule>
    <Story />
  </AppFocusRule>
);
