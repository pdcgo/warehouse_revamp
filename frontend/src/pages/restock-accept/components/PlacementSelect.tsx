import { Box } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { RackSelect } from "../../../components/pickers/RackSelect";

// THE PLACEMENT PICKER FOR A BOX'S UNITS — the shared RackSelect without the unplaced pile (there-is-no-unplaced-pile),
// laid out for a row of the put-away panel: a good units' row, or the broken units' marked row. ⚠ Always in a ROW: its
// `12rem` basis is a width there, and in a column it would be a height (it once stood 192px tall that way).
export function PlacementSelect({
  warehouseId,
  value,
  onChange,
  testId,
  disabled,
  takenRackIds,
}: {
  warehouseId: bigint;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
  /** Off until Diterima is set (putaway-waits-for-the-count). */
  disabled?: boolean;
  /** Racks the line's other placement rows hold — disabled here (one-rack-once-per-line). */
  takenRackIds?: string[];
}) {
  const { t } = useTranslation();

  return (
    // Shares a row with the quantity on a desktop; on a phone it takes the row and the quantity wraps under it.
    <Box flex="1 1 12rem" minW="0" data-testid={testId}>
      <RackSelect
        warehouseId={warehouseId}
        value={value}
        disabled={disabled}
        allowUnplaced={false}
        takenRackIds={takenRackIds}
        placeholder={t("restock.accept.placementPlaceholder")}
        onChange={onChange}
      />
    </Box>
  );
}
