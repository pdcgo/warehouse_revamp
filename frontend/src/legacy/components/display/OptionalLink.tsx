import type { ReactNode } from "react";
import { Box, Link } from "@chakra-ui/react";
import type { BoxProps, LinkProps } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";

// OptionalLink renders its children as a router link when there IS somewhere to go, and as a plain
// box when there is not.
//
// It exists because the alternative — `{href ? <Link>{x}</Link> : <div>{x}</div>}` — duplicates the
// children at every call site, and the two branches drift: one gains a class, a test id or a wrapper
// the other never gets. That drift shows up as a card that is subtly narrower when it happens to be
// unclickable.
//
// The case is common here because so much is CONDITIONALLY navigable: a statistic tile links to its
// breakdown only when a breakdown screen exists for it, a product cell links to the product only if
// the reader can see products, a supplier links only when it is a real supplier rather than a
// free-text name.
//
// ⚠ Without an href it renders NO interactive element at all — not a disabled link. A link that
// leads nowhere is worse than plain text: it takes a tab stop, it is announced as a link, and it
// invites a click that does nothing.
export const description =
  "Children as a router link when there is somewhere to go, and as plain content when there is not — without duplicating the children at the call site.";

export interface OptionalLinkProps extends Omit<BoxProps, "children"> {
  href?: string;
  children?: ReactNode;
}

export function OptionalLink({ href, children, ...rest }: OptionalLinkProps) {
  if (!href) {
    return (
      <Box data-testid="optional-link" data-linked="false" {...rest}>
        {children}
      </Box>
    );
  }

  return (
    // The cast is the price of one prop type covering both branches. `BoxProps` types its event
    // handlers against HTMLDivElement and `LinkProps` against HTMLAnchorElement, so the two are
    // structurally incompatible even though every STYLING prop is shared — which is the only kind a
    // caller passes here. The alternative is two exported prop types and a union at every call site,
    // for a difference nobody uses.
    <Link asChild data-testid="optional-link" data-linked="true" {...(rest as LinkProps)}>
      <RouterLink to={href}>{children}</RouterLink>
    </Link>
  );
}
