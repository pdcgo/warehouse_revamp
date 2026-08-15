import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";

import { ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Decorator, Preview } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";

import { Toaster } from "../src/components/feedback/Toaster";
import { AuthProvider } from "../src/features/auth/AuthContext";
import { clearToken, setToken } from "../src/features/auth/tokenStorage";
import { invalidateShippingCatalogue } from "../src/features/shipping/catalogue";
import { TeamProvider } from "../src/features/team/TeamContext";
import { system } from "../src/theme";
import "../src/i18n/config";

// The app shell, minus the app.
//
// A story renders a component inside the SAME providers main.tsx gives it — the real theme, a real
// QueryClient, the real i18n catalogues — because a component that only looks right under a
// story-only theme is a component whose story proves nothing.
//
// ⚠ THE HOOKS LIVE IN A COMPONENT, NOT IN THE DECORATOR. A Storybook decorator is a plain function
// that the renderer CALLS, not an element it mounts, so `useMemo`/`useEffect` written directly in a
// decorator body run with no React dispatcher and throw "Cannot read properties of null (reading
// 'useEffect')". The failure is also intermittent — it depends on whether the story happens to
// re-render — which makes it worth stating rather than rediscovering.
function StoryProviders({ colorMode, children }: { colorMode: "light" | "dark"; children: ReactNode }) {
  // A FRESH client per story. Sharing one would let a picker's options survive into the next story
  // and make a fetch that never happened look like it did — the cross-test leak that is hardest to
  // spot, because the story passes.
  //
  // The one deliberate difference from the app is `retry: false`. The app retries once so a dropped
  // connection is not an error the operator has to see; a story asserting the ERROR state would
  // otherwise sit through a pointless second attempt before the assertion could pass.
  const queryClient = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } }),
    [],
  );

  useEffect(() => () => queryClient.clear(), [queryClient]);

  // Color mode is one class on <html> (src/lib/colorMode.ts), so the toolbar switch runs the same
  // single line the app's own toggle does. Driving it from a global means every story can be
  // reviewed in both modes — something the hand-written gallery could not do.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", colorMode === "dark");
  }, [colorMode]);

  return (
    <ChakraProvider value={system}>
      <QueryClientProvider client={queryClient}>
        {/* Several shared components render a router Link in their `action` slot. A MemoryRouter
            costs nothing and turns "story crashed outside a Router" into a non-problem. */}
        <MemoryRouter>
          {children}
          <Toaster />
        </MemoryRouter>
      </QueryClientProvider>
    </ChakraProvider>
  );
}

const withProviders: Decorator = (Story, context) => (
  <StoryProviders colorMode={context.globals.colorMode === "dark" ? "dark" : "light"}>
    <Story />
  </StoryProviders>
);

// OPT-IN, via `parameters: { signedIn: true }` — not global, and that is the point.
//
// `useTeam()` THROWS outside a TeamProvider, so a component that reads the current team cannot be
// storied without one. But the provider chain is not free: AuthProvider does a CheckAccess on mount
// and TeamProvider then loads the caller's memberships, so every story would pay two requests and a
// `ready` gate for context all but one of them never touches.
//
// The token is planted before the providers mount because AuthProvider only calls CheckAccess when
// there IS one — with no token it settles as signed-out and TeamProvider yields no current team.
const withSignedIn: Decorator = (Story, context) => {
  if (!context.parameters.signedIn) {
    return <Story />;
  }

  setToken("storybook-token", false);

  return (
    <AuthProvider>
      <TeamProvider>
        <Story />
      </TeamProvider>
    </AuthProvider>
  );
};

const preview: Preview = {
  // Applied right-to-left, so `withSignedIn` runs INSIDE the Chakra/query providers it depends on.
  decorators: [withProviders, withSignedIn],
  initialGlobals: {
    colorMode: "light",
  },
  globalTypes: {
    colorMode: {
      description: "The app's light/dark mode",
      toolbar: {
        title: "Color mode",
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
  },
  async beforeEach() {
    // The courier catalogue is a MODULE-LEVEL session cache, not a query — it is loaded once and
    // shared by every ShippingBadge on a page (features/shipping/catalogue.ts). Module state
    // survives between stories in one browser tab, so without this a later story would render from
    // an earlier story's fetch and its loading state would be untestable.
    invalidateShippingCatalogue();
    // Same reasoning for the persisted color-mode override: a story that toggles the mode would
    // otherwise decide the mode for every story that runs after it.
    localStorage.removeItem("wh-color-mode");
    // …and for the auth token, so a `signedIn` story cannot leave the next one authenticated. The
    // selected team is sessionStorage, and is cleared with it.
    clearToken();
    sessionStorage.clear();
  },
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    options: {
      // The sidebar groups mirror `src/components/<group>/` one-for-one, so "where does this live?"
      // and "where do I find it?" have the same answer (CLAUDE.md's design-system rule).
      //
      // Ordered by how often the question gets asked, not alphabetically: Pickers is both the
      // largest group and the one most likely to already contain what somebody is about to build,
      // so it sits first. Chrome — the app furniture nobody reaches for twice — sits last.
      storySort: {
        order: [
          "Components",
          ["Pickers", "Date & Time", "Entity", "Badges", "Inputs", "Feedback", "Chrome"],
          "*",
        ],
      },
    },
  },
};

export default preview;
