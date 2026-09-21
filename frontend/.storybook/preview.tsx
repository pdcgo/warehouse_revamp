import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";

import { Box, ChakraProvider } from "@chakra-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Decorator, Preview } from "@storybook/react-vite";
import { MemoryRouter } from "react-router-dom";

import { Toaster } from "../src/components/feedback/Toaster";
import { AuthProvider } from "../src/features/auth/AuthContext";
import { clearToken, setToken } from "../src/features/auth/tokenStorage";
import { invalidateShippingCatalogue } from "../src/features/shipping/catalogue";
import { resetLiabilityPayments, resetLiabilityTerms, resetShipmentChannels, stubUploads } from "./stubTransport";
import { TeamProvider } from "../src/features/team/TeamContext";
import { SYSTEM_FONT_STACK, system } from "../src/theme";
import i18n from "../src/i18n/config";
import type { Lang } from "../src/i18n/language";

// The toolbar's Language, as the app's Lang. Anything but "id" is English — the default every story's
// play() asserts against.
function langOf(globals: Record<string, unknown>): Lang {
  return globals.locale === "id" ? "id" : "en";
}

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
  font,
  lang,
  ownRouter,
  pageGutter,
  children,
}: {
  colorMode: "light" | "dark";
  font: "lato" | "system";
  lang: Lang;
  ownRouter: boolean;
  pageGutter: boolean;
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

  // The toolbar's Language drives i18n with the same `changeLanguage` the app's own switcher calls
  // (useLanguage, src/i18n/language.ts) — minus its localStorage write, so browsing in Indonesian
  // leaves no preference behind. Switching re-renders the open story in place; a NEW story is set
  // before it renders, in `beforeEach`.
  useEffect(() => {
    document.documentElement.lang = lang;
    void i18n.changeLanguage(lang);
  }, [lang]);

  // ⚠ TEMPORARY — a before/after switch while the typeface is being decided; remove it once Lato is
  // settled. "System" overrides the two font variables the theme emits with the old stack, inline on
  // <html> so it beats the `:root` rule; "Lato" removes the override and the theme applies again.
  useEffect(() => {
    const root = document.documentElement.style;

    if (font === "system") {
      root.setProperty("--chakra-fonts-body", SYSTEM_FONT_STACK);
      root.setProperty("--chakra-fonts-heading", SYSTEM_FONT_STACK);
    } else {
      root.removeProperty("--chakra-fonts-body");
      root.removeProperty("--chakra-fonts-heading");
    }
  }, [font]);

  // A PAGE gets the gutter the desktop shell gives it in the app (`p="page"` on DesktopLayout's
  // <main>), so a page story reads the way the screen does. Everything else is `fullscreen` (see
  // `parameters.layout`) — a shell fills the frame, and a component sits flush.
  //
  // It lives here, inside ChakraProvider, rather than in a decorator of its own: `p="page"` is a theme
  // token, and resolving it must not depend on the order decorators happen to wrap in.
  const content = pageGutter ? <Box p="page">{children}</Box> : children;

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
        {ownRouter ? content : <MemoryRouter>{content}</MemoryRouter>}
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
    font={context.globals.font === "system" ? "system" : "lato"}
    lang={langOf(context.globals)}
    ownRouter={context.parameters.dataRouter === true}
    // The live app's pages only — `Legacy/Pages/*` and `LegacyWarehouse/Pages/*` stay fullscreen.
    pageGutter={context.title.startsWith("Pages/")}
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

// ── THE REAL CLIPBOARD IS NOT AVAILABLE TO THE TEST RUNNER ──────────────────────────────────────
//
// `navigator.clipboard.writeText` requires the document to be FOCUSED and the clipboard-write
// permission. A headless Vitest browser reliably has neither, so every copy-to-clipboard component
// (RefIdBadge, CopyText, CopyNumber) rejects with `NotAllowedError` — and because zag fires the write
// from inside a state-machine action, nothing awaits that promise. It surfaces as an UNHANDLED
// REJECTION, which Vitest reports separately from the tests and explicitly warns "might cause false
// positive tests".
//
// So the runner gets a stub instead of the platform API. It does two jobs:
//
//  1. It RESOLVES, so the component reaches its copied state and the confirmation UI is testable at
//     all — with the real API rejecting, the check-mark branch could never be exercised.
//  2. It RECORDS the written value on `window.__copiedText`, which is what makes the rule worth
//     testing testable: CopyNumber renders "Rp 1,5jt" and must copy `1500000`. Asserting on the
//     rendered text proves nothing about what landed on the clipboard.
//
// It is reinstalled per story rather than once, so a value copied in one story cannot be read as
// this story's.
function stubClipboard() {
  const stub = {
    writeText: (text: string) => {
      (window as unknown as { __copiedText?: string }).__copiedText = text;
      return Promise.resolve();
    },
    readText: () => Promise.resolve((window as unknown as { __copiedText?: string }).__copiedText ?? ""),
  };

  (window as unknown as { __copiedText?: string }).__copiedText = undefined;
  // `navigator.clipboard` is a read-only accessor, so assignment silently does nothing in some
  // engines and throws in strict mode — it has to be redefined.
  Object.defineProperty(navigator, "clipboard", { value: stub, configurable: true, writable: true });
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
    font: "lato",
    locale: "en",
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
    // The UI language, for reviewing a screen in Bahasa Indonesia.
    //
    // ⚠ ENGLISH IS THE DEFAULT, AND THE TESTS DEPEND ON IT: every play() asserts English text, and
    // `npm run test:stories` runs at the default. Browsing in Indonesian therefore shows those checks
    // FAILING in the Interactions panel — expected, and nothing to fix. The ~10 keys `id.json` lacks
    // fall back to English.
    locale: {
      description: "The app's UI language",
      toolbar: {
        title: "Language",
        icon: "globe",
        items: [
          { value: "en", title: "English" },
          { value: "id", title: "Bahasa Indonesia" },
        ],
        dynamicTitle: true,
      },
    },
    // ⚠ TEMPORARY — see the font effect in StoryProviders.
    font: {
      description: "The app typeface — Lato, or the system stack it replaced",
      toolbar: {
        title: "Font",
        icon: "paragraph",
        items: [
          { value: "lato", title: "Lato" },
          { value: "system", title: "System (before)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  async beforeEach(context) {
    // The language, set BEFORE the story renders. The Sidebar and MenuSheet stories carry the app's
    // real language switcher, which persists its choice — without this, a story that clicks it would
    // leave every later story in Indonesian.
    localStorage.removeItem("warehouse.lang");
    await i18n.changeLanguage(langOf(context.globals));
    // The courier catalogue is a MODULE-LEVEL session cache, not a query — it is loaded once and
    // shared by every ShippingBadge on a page (features/shipping/catalogue.ts). Module state
    // survives between stories in one browser tab, so without this a later story would render from
    // an earlier story's fetch and its loading state would be untestable.
    invalidateShippingCatalogue();
    // Same reasoning for the persisted color-mode override: a story that toggles the mode would
    // otherwise decide the mode for every story that runs after it.
    localStorage.removeItem("wh-color-mode");
    // …and for the legacy sidebar's collapse preference, which is persisted on purpose (an operator
    // sets it once) and would otherwise leave every later sidebar story rendering collapsed.
    localStorage.removeItem("legacy-sidebar-collapsed");
    // …and for the auth token, so a `signedIn` story cannot leave the next one authenticated. The
    // selected team is sessionStorage, and is cleared with it.
    clearToken();
    sessionStorage.clear();
    // The credit-terms table in the stub transport is WRITEABLE, so a story that freezes a team
    // would otherwise decide what every later story renders.
    resetLiabilityTerms();
    // The shipment channel table is writeable too — a story that deletes jne must not delete it for the next.
    resetShipmentChannels();
    // …and the payments table, which a story that REJECTS a claim writes to. Without this, whether a
    // pending payment still offers Confirm/Reject would depend on story order.
    resetLiabilityPayments();
    // …and the upload store, so a file attached in one story is not still "uploaded" in the next. It
    // also installs the fetch shim that answers the signed-URL PUT in the middle of every upload.
    stubUploads();
    stubClipboard();
  },
  parameters: {
    // No frame padding by default — the `Pages/` gutter is added in StoryProviders instead.
    layout: "fullscreen",
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
          // ⚠ THE WORKBENCH IS THE LIVE APP ONLY (owner). `src/legacy/` and `src/legacy_warehouse/` —
          // the two adopted UIs — used to carry ~185 story files of their own and had their own
          // sections here. They are a staging area, not a design system: nobody reviewed them in the
          // workbench, and their stories made up two thirds of the test suite. The screens are still
          // routed and still compile; they simply have no stories any more, and a new one does not
          // belong there either.
          "*",
        ],
      },
    },
  },
};

export default preview;
