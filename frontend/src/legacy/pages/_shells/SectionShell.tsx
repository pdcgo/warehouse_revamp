import type { ReactNode } from "react";
import { Heading, Stack, Text } from "@chakra-ui/react";
import { NavTabs, type NavTabItem } from "../../components/display/NavTabs";

// ── THE SECTION SHELL ───────────────────────────────────────────────────────────────────────────
//
// A dozen routes in the legacy system are PARENTS: they own a title and a row of tabs, and the
// screen itself is whichever child is selected. Billing, invoicing, accounting, stock and the rest
// all have one.
//
// They are one component with twelve configurations, not twelve shells. The alternative is twelve
// files that each re-implement a heading and a tab strip, and they drift immediately — one loses its
// subtitle, another puts the tabs above the title, a third forgets to make them links.
//
// ⚠ THE TABS ARE NAVIGATION, SO THEY ARE LINKS. Each child is a real route with its own URL. That
// matters more here than it looks: these are the screens people send each other ("look at the
// payable log"), and tabs implemented as local state produce a section that cannot be linked into —
// every share lands the recipient on the first tab.
//
// The shell renders no content of its own. What the selected tab shows is passed in, because the
// shell has no business knowing what a payable log looks like.
export const description =
  "The shared shell for a tabbed section — title, optional subtitle, and a row of tabs that are REAL LINKS. Twelve legacy sections use it; twelve hand-written copies would drift immediately.";

export interface SectionShellProps<K extends string> {
  title: string;
  // One line on what the section is for. Worth having: a dozen sections whose tabs all read
  // "List / Detail / History" are told apart by this and nothing else.
  subtitle?: string;
  tabs: Array<NavTabItem<K>>;
  active: K;
  // Turns a tab key into its route.
  hrefFor(key: K): string;
  // The selected child. The shell does not know or care what it is.
  children?: ReactNode;
}

export function SectionShell<K extends string>({
  title,
  subtitle,
  tabs,
  active,
  hrefFor,
  children,
}: SectionShellProps<K>) {
  return (
    <Stack gap="section" data-testid="section-shell" data-section={title}>
      <Stack gap="0.5">
        <Heading size="md">{title}</Heading>
        {subtitle && (
          <Text fontSize="sm" color="fg.muted">
            {subtitle}
          </Text>
        )}
      </Stack>

      <NavTabs items={tabs} value={active} hrefFor={hrefFor} />

      {/* The child route renders here. In the real app this is an <Outlet/>; as a reference screen
          it is whatever the caller passes, so the shell can be reviewed on its own. */}
      {children}
    </Stack>
  );
}
