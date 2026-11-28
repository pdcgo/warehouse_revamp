import { Box, Flex, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { HelperLink } from "../../../components/feedback/HelperLink";
import { RackSelect } from "../../../components/pickers/RackSelect";
import { useRacks } from "../../../features/racks/queries";

const RACKS_PAGE = "/inventories/racks";

// THE PLACEMENT PICKER FOR A BOX'S UNITS — the shared RackSelect without the unplaced pile (there-is-no-unplaced-pile),
// laid out for a row of the put-away panel: a good units' row — broken units go on no rack
// (a-restocks-broken-units-are-just-broken-for-now). ⚠ Always in a ROW: its `12rem` basis is a width there, and in a
// column it would be a height (it once stood 192px tall that way).
//
// A WAREHOUSE WITH NO RACK POINTS TO THE RACKS PAGE (the-accept-page-points-to-the-racks-page) — the good units have
// nowhere to go and Terima cannot finish, so under the picker: *no rack yet* and a link to Racks, for EVERY warehouse
// role (owner *"C"*: staff too — they are refused the create there, as today). In a NEW TAB, and the racks are read
// again on the way back, every count typed still there (a-helper-link-opens-a-new-tab). The racks are this picker's own
// read, handed to RackSelect — the same cache entry every row shares, so nothing more is asked.
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
  const racks = useRacks({ warehouseId, rereadOnReturn: true });
  const noRack = racks.isSuccess && racks.data.length === 0;
  const helperId = testId ?? "placement-select";

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
        racks={racks}
      />
      {noRack && (
        <Flex align="center" gap="1.5" wrap="wrap" rowGap="0.5" mt="1" data-testid={`${helperId}-no-rack`}>
          <Text fontSize="xs" color="fg.muted">
            {t("restock.accept.noRack")}
          </Text>
          <HelperLink href={RACKS_PAGE} label={t("restock.accept.openRacks")} testId={`${helperId}-open-racks`} />
        </Flex>
      )}
    </Box>
  );
}
