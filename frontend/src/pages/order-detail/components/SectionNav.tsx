import { useEffect, useRef } from "react";
import { Box, Button, Flex, Icon, Stack } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import type { SectionKey } from "../sections";
import { SECTIONS } from "../sections";

// THE LEFT NAVIGATION — one item per section, and the one you are reading lit (owner: *"navigasi di
// kiri untuk auto scroll"*).
//
// ⚠ TWO SHAPES, EXACTLY ONE MOUNTED. A column on a desktop; a strip of chips under the header on a
// phone, where there is no left to put it in. The caller picks with `useIsMobile` — a JS branch, never
// `hideBelow`, for the same reason the app shell is split that way: CSS-hiding one would put two
// `navigation` landmarks and two of every item in the page.
//
// ⚠ THE ITEMS ARE BUTTONS, NOT LINKS. They scroll within the page and change no URL; an `<a href="#…">`
// would add a history entry per click and fight the data router over the hash.

export function SectionNav({
  active,
  onSelect,
  compact = false,
}: {
  active: SectionKey;
  onSelect: (key: SectionKey) => void;
  /** The phone's horizontal strip rather than the desktop column. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const strip = useRef<HTMLDivElement>(null);

  // ⚠ ON A PHONE THE ACTIVE CHIP IS KEPT IN VIEW, by scrolling the STRIP rather than the chip. A chip's
  // own `scrollIntoView` would also scroll every ancestor — and in Chrome that cancels the page's smooth
  // scroll halfway, so tapping "Withdrawal" would stop somewhere in Timeline.
  useEffect(() => {
    if (!compact || !strip.current) {
      return;
    }

    const chip = strip.current.querySelector<HTMLElement>(`[data-section="${active}"]`);

    if (chip) {
      strip.current.scrollTo({ left: chip.offsetLeft - 16, behavior: "smooth" });
    }
  }, [active, compact]);

  if (compact) {
    return (
      <Box as="nav" aria-label={t("orderDetail.nav.label")} data-testid="section-nav-strip">
        <Flex ref={strip} gap="2" overflowX="auto" pb="1" css={{ scrollbarWidth: "none" }}>
          {SECTIONS.map((section) => {
            const on = section.key === active;

            return (
              <Button
                key={section.key}
                size="xs"
                rounded="full"
                flexShrink="0"
                variant={on ? "solid" : "outline"}
                colorPalette={on ? "brand" : "gray"}
                aria-current={on ? "location" : undefined}
                data-section={section.key}
                data-testid={`section-nav-${section.key}`}
                onClick={() => onSelect(section.key)}
              >
                <Icon as={section.icon} boxSize="3.5" />
                {t(section.navKey)}
              </Button>
            );
          })}
        </Flex>
      </Box>
    );
  }

  return (
    <Box as="nav" aria-label={t("orderDetail.nav.label")} data-testid="section-nav">
      <Stack gap="0.5">
        {SECTIONS.map((section) => {
          const on = section.key === active;

          return (
            <Button
              key={section.key}
              variant="ghost"
              justifyContent="flex-start"
              w="full"
              // The rule on the left edge is the marker; the tint alone is too quiet to find at a
              // glance, and bold alone shifts the width of the label.
              borderStartWidth="2px"
              borderColor={on ? "brand.solid" : "transparent"}
              roundedStart="0"
              bg={on ? "bg.muted" : undefined}
              color={on ? "fg" : "fg.muted"}
              fontWeight={on ? "bold" : undefined}
              aria-current={on ? "location" : undefined}
              data-section={section.key}
              data-testid={`section-nav-${section.key}`}
              onClick={() => onSelect(section.key)}
            >
              <Icon as={section.icon} boxSize="4" color={on ? "brand.fg" : "fg.subtle"} />
              {t(section.navKey)}
            </Button>
          );
        })}
      </Stack>
    </Box>
  );
}
