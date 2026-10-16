import { useTranslation } from "react-i18next";
import { Badge, Button, Checkbox, Group, HStack, Icon, IconButton, Popover, Portal, Stack } from "@chakra-ui/react";
import { SlidersHorizontal, X } from "lucide-react";

import { useIsMobile } from "../../../layouts/shell";
import { NotImplemented } from "../../../features/pending/NotImplemented";
import { SHOPS_LIST_PENDING } from "../pending";

// THE SHOPS LIST'S FILTER PANEL (owner: *"bedakan belum ada csnya"*, then *"pakai panel untuk checkbox"*) — the ticks,
// behind one Filter trigger that counts how many are on: today, Belum ada CS utama. The accounts list's panel is the
// shape (`operational-and-archived-share-one-filter-panel`).
//
//   [⚙ Filter 1][×] ⚠3
//   ┌──────────────────────┐
//   │ ☑ Belum ada CS utama │
//   └──────────────────────┘
//
// While a tick is on, the trigger is in the main tone with its count, and an × ATTACHED to its end turns every tick off
// without opening the panel (every-filter-clears-from-its-own-x) — a sibling, never a button inside the trigger. The ⚠
// mark sits beside it, where it is seen without opening anything: nothing narrows the list by it yet.
//
// ON A PHONE the FilterBar has already put every control in its bottom sheet, so the tick stands there as it is — a
// popover inside a sheet is a panel inside a panel. A JS breakpoint, never CSS.
export function ShopOptionsFilter({
  noPrimaryOnly,
  onNoPrimaryOnlyChange,
}: {
  noPrimaryOnly: boolean;
  onNoPrimaryOnlyChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const on = [noPrimaryOnly].filter(Boolean).length;
  const mark = <NotImplemented list={SHOPS_LIST_PENDING} id="noPrimaryFilter" />;

  const tick = (
    <Checkbox.Root
      checked={noPrimaryOnly}
      onCheckedChange={(e) => onNoPrimaryOnlyChange(!!e.checked)}
      data-testid="shops-no-primary-only"
    >
      <Checkbox.HiddenInput />
      <Checkbox.Control />
      <Checkbox.Label whiteSpace="nowrap">{t("shops.noPrimary")}</Checkbox.Label>
    </Checkbox.Root>
  );

  if (isMobile) {
    return (
      <HStack gap="1">
        {tick}
        {mark}
      </HStack>
    );
  }

  return (
    <HStack gap="1" flexShrink="0">
      <Popover.Root positioning={{ placement: "bottom-start" }}>
        <Group attached>
          <Popover.Trigger asChild>
            <Button
              variant={on > 0 ? "subtle" : "outline"}
              colorPalette={on > 0 ? "brand" : "gray"}
              borderWidth="1px"
              borderColor={on > 0 ? "brand.solid" : "border"}
              data-testid="shops-options-trigger"
            >
              <Icon as={SlidersHorizontal} boxSize="4" />
              {t("common.filters")}
              {on > 0 && (
                <Badge colorPalette="brand" variant="solid" size="xs" data-testid="shops-options-count">
                  {on}
                </Badge>
              )}
            </Button>
          </Popover.Trigger>
          {on > 0 && (
            <IconButton
              variant="subtle"
              colorPalette="brand"
              borderWidth="1px"
              borderColor="brand.solid"
              aria-label={t("shops.filter.optionsClear")}
              // It fades in when a tick goes on (`a-filter-answers-as-it-changes`).
              animationStyle="appear"
              onClick={() => onNoPrimaryOnlyChange(false)}
              data-testid="shops-options-clear"
            >
              <Icon as={X} boxSize="3.5" />
            </IconButton>
          )}
        </Group>
        <Portal>
          <Popover.Positioner>
            <Popover.Content w="auto" data-testid="shops-options-panel">
              <Popover.Body>
                <Stack gap="3">{tick}</Stack>
              </Popover.Body>
            </Popover.Content>
          </Popover.Positioner>
        </Portal>
      </Popover.Root>
      {mark}
    </HStack>
  );
}
