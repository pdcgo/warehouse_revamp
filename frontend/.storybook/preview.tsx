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
function StoryProviders({
  colorMode,
  ownRouter,
  children,
}: {
  colorMode: "light" | "dark";
  ownRouter: boolean;
  children: ReactNode;
}) {
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
            costs nothing and turns "story crashed outside a Router" into a non-problem.

            ⚠ BUT IT IS THE WRONG ROUTER FOR SOME STORIES, AND THERE IS NO ROUTER THAT SUITS BOTH.
            `useBlocker` — the unsaved-work guard on the order form — needs a DATA router
            (createMemoryRouter + RouterProvider); the component `<MemoryRouter>` has no data-router
            context and the hook throws "useBlocker must be used within a data router". Nesting one
            inside the other is not an option either: react-router refuses with "You cannot render a
            <Router> inside another <Router>".

            So a story that needs the data router declares `parameters: { dataRouter: true }` and
            builds its own; this decorator then supplies NO router at all. Opt-in rather than
            default, for the same reason `signedIn` is: a data router means naming routes, and the
            ~40 stories that only render a Link should not have to. */}
        {ownRouter ? children : <MemoryRouter>{children}</MemoryRouter>}
        {/* Outside the router deliberately — a toast is chrome, it renders no Link, and keeping it
            out is what lets the branch above swap routers without moving it. */}
        <Toaster />
      </QueryClientProvider>
    </ChakraProvider>
  );
}

const withProviders: Decorator = (Story, context) => (
  <StoryProviders
    colorMode={context.globals.colorMode === "dark" ? "dark" : "light"}
    ownRouter={context.parameters.dataRouter === true}
  >
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

// ── BIGINT ARGS BREAK THE CONTROLS PANEL ────────────────────────────────────────────────────────
//
// Storybook infers a control from the ARG'S VALUE. `bigint` is not one of the types it knows, so it
// falls back to the object control — and that control renders by calling `JSON.stringify`, which
// throws `TypeError: Do not know how to serialize a BigInt`. The throw is caught by the panel's error
// boundary, so the symptom is the whole Controls tab reading **"This addon has errors"** rather than
// anything naming the arg or the story.
//
// That is most of this design system: every id on the wire is a `uint64`, which protobuf-es maps to
// `bigint`, so `teamId`, `warehouseId`, `value: bigint[]` and friends are on nearly every picker.
//
// So the fix is global rather than per-story. An enhancer looks at each story's initial args and
// turns the CONTROL off for anything holding a bigint — the row still appears in the table with its
// type and description, it simply is not editable. Editing an opaque id by hand was never a useful
// thing to do anyway; what the panel is for here is showing what a story was given.
//
// ⚠ Do NOT "fix" this by making the args plain numbers. `Number` loses precision above 2^53 and the
// components genuinely take `bigint` — a story that lied about the type would be testing a different
// component from the one that ships.
function holdsBigInt(value: unknown, depth = 0): boolean {
  if (typeof value === "bigint") {
    return true;
  }

  // Two levels is enough for the shapes that actually occur (an array of ids, an object of ids) and
  // keeps a cyclic or huge arg from turning this into a deep walk on every story render.
  if (depth >= 2 || value === null || typeof value !== "object") {
    return false;
  }

  return Object.values(value as Record<string, unknown>).some((v) => holdsBigInt(v, depth + 1));
}

const preview: Preview = {
  // Applied right-to-left, so `withSignedIn` runs INSIDE the Chakra/query providers it depends on.
  decorators: [withProviders, withSignedIn],
  argTypesEnhancers: [
    (context) => {
      const argTypes = { ...context.argTypes };

      for (const [name, value] of Object.entries(context.initialArgs ?? {})) {
        if (holdsBigInt(value)) {
          argTypes[name] = { ...argTypes[name], name, control: false };
        }
      }

      return argTypes;
    },
  ],
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
      // Ordered by how often the question gets asked, not alphabetically. Chrome — the app furniture
      // nobody reaches for twice — sits last.
      //
      // The SUBJECT groups lead — Orders, Products, Customers, Teams — and they are the ones
      // organised by what they are ABOUT rather than by kind. Those are the subjects this system is
      // made of, so they are what somebody is most likely to be about to re-implement. Grouping them
      // that way beats splitting them across Pickers and Entity, where a picker sat two folders from
      // the row renderer it mounts.
      //
      // Pages sit BELOW the components they are assembled from — a screen is read after its parts,
      // and the design-system groups are what somebody browses for reuse.
      storySort: {
        order: [
          "Components",
          [
            // The SUBJECT groups lead — an order, and the product, customer and team it is made of,
            // are what somebody is most likely to be about to re-implement. The by-kind groups follow.
            "Orders",
            "Products",
            "Customers",
            "Teams",
            "Pickers",
            "Date & Time",
            "Entity",
            "Badges",
            "Inputs",
            "Feedback",
            "Chrome",
            // ⚠ EVERY GROUP MUST BE LISTED ABOVE, and this is why the wildcard is here rather than
            // implied: a group missing from this list does not disappear, it lands silently at the
            // BOTTOM — below Chrome, past where anybody scrolls — and reads as a story that failed to
            // register. `Orders` spent its first hour there. The `*` at least names the bucket.
            "*",
          ],
          // The shell sits BETWEEN them, in assembly order: it is made of components, and every
          // page is mounted inside it.
          "Layouts",
          "Pages",
          "*",
        ],
      },
    },
  },
};

export default preview;
