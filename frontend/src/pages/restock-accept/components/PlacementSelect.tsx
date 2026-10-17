import { Box } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { RackSelect } from "../../../components/pickers/RackSelect";

// THE PLACEMENT PICKER FOR A BOX'S GOOD UNITS — the shared RackSelect without the unplaced pile
// (there-is-no-unplaced-pile), laid out for a placement row.
export function PlacementSelect({
  warehouseId,
  value,
  onChange,
  testId,
}: {
  warehouseId: bigint;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  const { t } = useTranslation();

  return (
    // Shares a row with the quantity on a desktop; on a phone it takes the row and the quantity wraps under it.
    <Box flex="1 1 12rem" minW="0" data-testid={testId}>
      <RackSelect
        warehouseId={warehouseId}
        value={value}
        allowUnplaced={false}
        placeholder={t("restock.accept.placementPlaceholder")}
        onChange={onChange}
      />
    </Box>
  );
}
