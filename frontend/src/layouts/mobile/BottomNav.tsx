import { Flex, Icon, Text } from "@chakra-ui/react";
import { Menu as MenuIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useTeam } from "../../features/team/TeamContext";
import { activeRoute, bottomBarFor } from "../nav";

// THE BOTTOM TAB BAR — the mobile shell's whole navigation surface, and the thumb's only one-tap
// reach. Three destinations for THIS team (see `bottomBarFor`) plus More, which opens the full menu.
//
// ⚠ THE ACTIVE TAB IS MATCHED AGAINST THE BAR, NOT AGAINST THE MENU. The same longest-prefix rule
// (nav.ts), run over these four items — so standing on /products/discover lights the Products tab
// even though the menu's winner there is a child route the bar does not carry. Running it over the
// whole menu instead would light nothing on any sub-route, and a tab bar with no lit tab reads as
// having fallen out of the app.
//
// MORE LIGHTS WHEN NOTHING ELSE DOES, so there is always exactly one lit tab: it is the tab that
// owns everywhere the other three do not.
export function BottomNav({
  menuOpen,
  onMenuOpen,
}: {
  menuOpen: boolean;
  onMenuOpen: () => void;
}) {
  const { current } = useTeam();
  const { t } = useTranslation();
  const location = useLocation();

  const items = bottomBarFor(current?.teamType, current?.role);
  const activeTo = activeRoute(items, location.pathname);

  return (
    <Flex
      as="nav"
      data-testid="bottom-nav"
      flexShrink={0}
      borderTopWidth="1px"
      borderColor="border"
      bg="bg.subtle"
      // The iOS home indicator sits over the bottom of the viewport; without this the last row of
      // labels lives underneath it.
      pb="env(safe-area-inset-bottom)"
    >
      {items.map((item) => (
        <Tab
          key={item.to}
          to={item.to}
          label={t(item.label)}
          icon={item.icon}
          active={item.to === activeTo}
        />
      ))}

      <Tab
        label={t("nav.more")}
        icon={MenuIcon}
        active={menuOpen || activeTo === undefined}
        expanded={menuOpen}
        testId="bottom-nav-more"
        onClick={onMenuOpen}
      />
    </Flex>
  );
}

// One tab — a link, or the More button, which are the same shape on purpose: More is a destination
// as far as the person tapping it is concerned.
//
// ⚠ THE WHOLE TAB IS THE TARGET. `flex="1"` on the anchor rather than on a wrapper is what makes the
// tap area the full column height and width; an icon-sized hit box in a bar this short is the
// difference between navigating and missing.
function Tab({
  to,
  label,
  icon,
  active,
  expanded,
  testId,
  onClick,
}: {
  to?: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  expanded?: boolean;
  testId?: string;
  onClick?: () => void;
}) {
  const body = (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="1"
      py="2"
      // ⚠ `w="full"` IS LOAD-BEARING, and its absence is invisible to every assertion about text.
      // The tab is a flex row and this is its only child, so without a width it is shrink-to-fit and
      // packs to the START of the column — a 24px label sitting at the left edge of a 98px slot. The
      // `align="center"` below centres the icon over the label; it cannot centre this box in a column
      // it does not fill.
      w="full"
      h="full"
      textAlign="center"
      color={active ? "brand.fg" : "fg.muted"}
      _hover={{ color: "brand.fg" }}
    >
      <Icon as={icon} boxSize="5" />
      <Text fontSize="2xs" fontWeight={active ? "semibold" : "medium"} lineClamp={1}>
        {label}
      </Text>
    </Flex>
  );

  // `data-active` on both branches, because the two are not otherwise comparable: a link says it is
  // current with `aria-current`, and More is a BUTTON — it opens a sheet rather than going anywhere,
  // so `aria-current="page"` on it would be a lie to a screen reader. One attribute both carry is what
  // lets "exactly one tab is lit" be asserted at all.
  const flag = active ? "" : undefined;

  if (to === undefined) {
    return (
      <Flex
        as="button"
        flex="1"
        minW="0"
        cursor="pointer"
        data-testid={testId}
        data-active={flag}
        aria-label={label}
        // ⚠ `expanded`, NOT `active`: More is also lit when the current screen has no tab of its own,
        // and announcing a shut sheet as expanded is a lie a screen reader cannot see past.
        aria-expanded={expanded}
        onClick={onClick}
      >
        {body}
      </Flex>
    );
  }

  // `asChild` rather than `as={Link}`: the router's own <Link> stays the element (and keeps its
  // props typed), and Chakra styles it — `as` would drop `to` from the prop types.
  return (
    <Flex asChild flex="1" minW="0">
      <Link
        to={to}
        data-testid={testId}
        data-active={flag}
        aria-current={active ? "page" : undefined}
      >
        {body}
      </Link>
    </Flex>
  );
}
