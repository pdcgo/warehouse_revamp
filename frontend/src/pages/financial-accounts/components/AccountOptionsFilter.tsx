import { useTranslation } from "react-i18next";
import { Badge, Button, Checkbox, Icon, Popover, Portal, Stack } from "@chakra-ui/react";
import { SlidersHorizontal } from "lucide-react";

import { useIsMobile } from "../../../layouts/shell";

// THE FILTER PANEL (owner, `operational-and-archived-share-one-filter-panel`) — the switches that rarely change,
// behind one Filter trigger that counts how many are on. Archived LEFT it for a view of its own
// (`the-archive-is-its-own-view`), so today it holds Operational only.
//
// ON A PHONE the FilterBar has already put every control in its bottom sheet, so the checkbox stands there as
// it is — a popover inside a sheet is a panel inside a panel. A JS breakpoint, never CSS.
export function AccountOptionsFilter({
  operationalOnly,
  onOperationalOnlyChange,
}: {
  operationalOnly: boolean;
  onOperationalOnlyChange: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const on = [operationalOnly].filter(Boolean).length;

  const boxes = (
    <Stack gap="3">
      <Checkbox.Root
        checked={operationalOnly}
        onCheckedChange={(e) => onOperationalOnlyChange(!!e.checked)}
        data-testid="account-operational-only"
      >
        <Checkbox.HiddenInput />
        <Checkbox.Control />
        <Checkbox.Label>{t("financialAccounts.operationalOnly")}</Checkbox.Label>
      </Checkbox.Root>
    </Stack>
  );

  if (isMobile) return boxes;

  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <Button variant="outline" colorPalette="gray" data-testid="account-options-trigger">
          <Icon as={SlidersHorizontal} boxSize="4" />
          {t("common.filters")}
          {on > 0 && (
            <Badge colorPalette="brand" variant="solid" size="xs" data-testid="account-options-count">
              {on}
            </Badge>
          )}
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content w="auto" data-testid="account-options-panel">
            <Popover.Body>{boxes}</Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}
