import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Box, Button, Flex, HStack, Icon, Text } from "@chakra-ui/react";
import { ArrowLeftRight, Link2 } from "lucide-react";

import type { SupplierChannel } from "../../../gen/warehouse/supplier/v1/supplier_channel_pb";
import type { SupplierRecord } from "../../../features/suppliers/adapt";
import { LineSupplier } from "../../../features/restock/LineSupplier";
import { SupplierChannelPicker, type SupplierChannelPick } from "../../../components/pickers/SupplierChannelPicker";

export interface SupplierBoxProps {
  teamId: bigint;
  /** What is chosen; `supplierId` 0n = nothing yet. */
  value: SupplierChannelPick;
  suppliers: Record<string, SupplierRecord>;
  channels: Record<string, SupplierChannel>;
  onPick: (pick: SupplierChannelPick) => void;
  /** Closed — shown, never changed (a stored line while the box is at the door). */
  locked?: boolean;
  /** What an empty box says — *Belum dipilih*. */
  noneText: string;
  /** After the supplier's name, on its line — the *Ikut semua* mark. */
  after?: ReactNode;
  /** More actions at the box's end — ✕, Ikut Semua. */
  actions?: ReactNode;
  /** `<testId>-field` is the box; the chosen supplier, or the empty text, is `shownTestId`. */
  testId: string;
  shownTestId: string;
  /** The popup's prefix while nothing is chosen, and once something is — they may differ. */
  pickerTestId: string;
  changeTestId: string;
}

// SupplierBox — WHERE SOMETHING WAS BOUGHT, AS A FIELD: the same box for the card's supplier part and for each product's
// *Dibeli dari* (owner: *"hubungkan supplier per produk desainnya kurang"*, a-product-picks-its-supplier-from-the-same-box).
//
//   ┌──────────────────────────────────────────────┐
//   │ Belum dipilih                [⛓ Pilih Supplier] │    nothing yet
//   └──────────────────────────────────────────────┘
//   ┌──────────────────────────────────────────────┐
//   │ CV Cahaya Abadi  [Ikut semua]      [⇄ Ganti] ✕ │    chosen — the name, then the store under it
//   │ Other · cahayaabadi.co.id                     │
//   └──────────────────────────────────────────────┘
//
// One height, picked or not, and it never wraps: the name gives way, the buttons hold their place.
export function SupplierBox({
  teamId,
  value,
  suppliers,
  channels,
  onPick,
  locked,
  noneText,
  after,
  actions,
  testId,
  shownTestId,
  pickerTestId,
  changeTestId,
}: SupplierBoxProps) {
  const { t } = useTranslation();
  const chosen = value.supplierId > 0n;

  return (
    <Flex
      gap="2"
      align="center"
      borderWidth="1px"
      borderColor="border.emphasized"
      borderRadius="md"
      bg={locked ? "bg.muted" : undefined}
      px="3"
      h="14"
      minW="0"
      data-testid={`${testId}-field`}
    >
      <Box flex="1" minW="0">
        {chosen ? (
          <LineSupplier
            supplierId={value.supplierId}
            supplierChannelId={value.supplierChannelId}
            suppliers={suppliers}
            channels={channels}
            after={after}
            testId={shownTestId}
          />
        ) : (
          <Text fontSize="sm" color="fg.muted" lineClamp={1} data-testid={shownTestId}>
            {noneText}
          </Text>
        )}
      </Box>

      {!locked && (
        <HStack gap="1" flexShrink={0}>
          <SupplierChannelPicker
            teamId={teamId}
            value={chosen ? value : undefined}
            onChange={onPick}
            testId={chosen ? changeTestId : pickerTestId}
            trigger={
              <Button type="button" size="xs" variant="outline">
                <Icon as={chosen ? ArrowLeftRight : Link2} boxSize="4" />
                {chosen ? t("restock.form.changeSupplier") : t("restock.form.allSupplierPick")}
              </Button>
            }
          />
          {actions}
        </HStack>
      )}
    </Flex>
  );
}
