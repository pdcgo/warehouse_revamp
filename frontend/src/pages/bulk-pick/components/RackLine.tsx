import { useTranslation } from "react-i18next";
import { Badge, Flex, Icon, Text } from "@chakra-ui/react";
import { TriangleAlert } from "lucide-react";

import type { PickRack } from "../../../features/picking/bulkPick";

/**
 * WHERE TO WALK, ON ONE LINE — each rack once with how many to take from it (`A-01-1 ×2`), the unplaced pile in words
 * (`Belum Dirakkan ×1`, gray — a real place, never a blank), and any units no take recorded a rack for, said as the
 * single pick page says it. Never one rack chosen for the picker: two racks are two stops (#135/#151).
 *
 * The racks sit side by side and wrap, so a table cell stays one or two lines (one-context-per-column-and-never-three-lines).
 * Each rack carries `data-rack-code` / `data-quantity`, so a story reads the walk without parsing text.
 */
export function RackLine({ racks, unrecorded, testId }: { racks: PickRack[]; unrecorded: number; testId: string }) {
  const { t } = useTranslation();

  return (
    <Flex align="center" gap="1.5" wrap="wrap" rowGap="1" data-testid={testId}>
      {racks.map((rack) => (
        <Flex
          key={rack.rackId.toString()}
          align="center"
          gap="1"
          data-testid={`${testId}-${rack.rackId}`}
          data-rack-code={rack.rackId === 0n ? "" : rack.rackCode}
          data-quantity={rack.quantity}
        >
          <Badge colorPalette={rack.rackId === 0n ? "gray" : "brand"}>
            {rack.rackId === 0n ? t("picking.table.unplaced") : rack.rackCode}
          </Badge>
          <Text fontSize="sm" fontWeight="bold" me="1.5">
            ×{rack.quantity}
          </Text>
        </Flex>
      ))}

      {unrecorded > 0 && (
        <Flex align="center" gap="1" color="fg.muted" data-testid={`${testId}-unrecorded`} data-quantity={unrecorded}>
          <Icon as={TriangleAlert} boxSize="4" />
          <Text fontSize="sm">
            {t("picking.table.noRecordedShelf")} ×{unrecorded}
          </Text>
        </Flex>
      )}
    </Flex>
  );
}
