import type { ElementType, ReactNode } from "react";
import { Icon, Tabs } from "@chakra-ui/react";
import { Link as RouterLink } from "react-router-dom";

export interface NavTabItem<K extends string> {
  key: K;
  label: ReactNode;
  icon?: ElementType;
  hidden?: boolean;
}

// `line` underlines the active tab and belongs at the top of a page — it reads as a division of the
// page below it. `enclosed` puts the set in a filled tray, and belongs INSIDE a card or panel, where
// an underline would be mistaken for the card's own border.
export type NavTabsVariant = "line" | "enclosed";

// NavTabs is tabs used for NAVIGATION: each tab is a place with its own URL.
//
// The `hrefFor` prop is what makes it that rather than a state toggle, and it is the whole point.
// A tabbed section whose tabs are not links is a section nobody can send a colleague to, that loses
// its place on refresh, and that the back button walks straight out of instead of back one tab. With
// hrefs, each tab is a real route and all three of those work for free.
//
// Without `hrefFor` it falls back to controlled tabs — for the rare in-page case where the tab is
// genuinely not a location. If you are choosing a FILTER rather than a place, use ChoiceTabs.
export const description =
  "Tabs for navigation — each tab is a route, so it is linkable, survives a refresh and works with the back button. For filters, use ChoiceTabs instead.";

export interface NavTabsProps<K extends string> {
  items: Array<NavTabItem<K>>;
  value: K;
  // Turn a tab key into a route. Supplying it is what makes the tabs real links.
  hrefFor?(key: K): string;
  onChange?(key: K): void;
  variant?: NavTabsVariant;
  size?: "sm" | "md" | "lg";
}

export function NavTabs<K extends string>({
  items,
  value,
  hrefFor,
  onChange,
  variant = "line",
  size = "md",
}: NavTabsProps<K>) {
  return (
    <Tabs.Root
      value={value}
      onValueChange={(e) => onChange?.(e.value as K)}
      variant={variant}
      size={size}
      colorPalette="brand"
      data-testid="nav-tabs"
    >
      <Tabs.List>
        {items
          .filter((t) => !t.hidden)
          .map((item) => {
            const content = (
              <>
                {item.icon && <Icon as={item.icon} boxSize="3.5" />}
                {item.label}
              </>
            );

            return (
              <Tabs.Trigger
                key={item.key}
                value={item.key}
                // asChild swaps the trigger's element for a router Link while keeping the tab's
                // roles, keyboard handling and active state. A plain <a> inside the trigger would
                // give you a link inside a tab — two focus stops for one destination.
                asChild={hrefFor !== undefined}
                data-testid={`nav-tab-${item.key}`}
              >
                {hrefFor ? <RouterLink to={hrefFor(item.key)}>{content}</RouterLink> : content}
              </Tabs.Trigger>
            );
          })}
      </Tabs.List>
    </Tabs.Root>
  );
}
