import { Box, Flex, Icon, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Warehouse } from "lucide-react";

import { TeamSelect } from "../../../components/teams/TeamSelect";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";

// THE BUILDING THIS ORDER IS BUILT ON — first, and not a card (owner).
//
// ⚠ IT IS THE SCREEN'S SCOPE, NOT A FIELD OF THE ORDER. Everything else on this form is a FACT to
// record — which shop, which customer, what was printed on the slip. The warehouse is the thing all
// of those facts are measured against:
//
//   • every stock figure and every HPP on the screen is this building's (`useStockAvailability`,
//     `useStockCosts`), so changing it re-reads the whole form;
//   • picking a product is refused until it is answered (OrderItemCard);
//   • it is a creditor of the order — its fee, and its row in Debt Limits.
//
// A card in the flow would read as "step one of seven". A band ABOVE the flow, on its own surface,
// reads as what it is: the context the cards below are filled in under.
//
// ⚠ NOT A GATE, though. The warehouse arrives pre-filled from the team's default (#145), so for most
// orders it is already right — standing a modal in front of every order to confirm a value nobody
// needs to change would add a click to the common case to dramatise the rare one. This makes it
// impossible to MISS without making it something to dismiss.
export function WarehouseBand({
  value,
  onChange,
  disabled,
}: {
  value: bigint;
  onChange: (warehouseId: bigint) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const chosen = value > 0n;

  return (
    <Box
      borderWidth="1px"
      // Unanswered, it is the one thing on the screen asking a question — and the border is what says
      // so, in the app's own accent rather than in an alarm colour: nothing is WRONG, something is
      // simply not decided yet.
      borderColor={chosen ? "border" : "brand.focusRing"}
      borderRadius="l2"
      bg="bg.subtle"
      px="card"
      py="3"
      data-testid="order-warehouse-band"
    >
      <Flex direction="column" gap="card" wrap="wrap" justify="space-between">
        <Flex align="center" gap="3" minW="0">
          <Icon as={Warehouse} boxSize="5" color={chosen ? "fg.muted" : "brand.fg"} flexShrink="0" />

          <Stack gap="0.5" minW="0">
            <Text fontSize="sm" fontWeight="bold" color="fg.label">
              {t("orderForm.warehouse.title")}
            </Text>
            {/* WHAT IT GOVERNS — the sentence a person needs exactly once, and the one that explains
                why this control is up here rather than in a card with the shop. */}
            <Text fontSize="xs" color={chosen ? "fg.muted" : "brand.fg"}>
              {chosen ? t("orderForm.warehouse.governs") : t("orderForm.warehouse.chooseFirst")}
            </Text>
          </Stack>
        </Flex>

        {/* The picker keeps the id the rest of the app knows it by: the e2e fills this input, and the
            prefill story reads it. */}
        <Box w={{ base: "full", md: "80" }} data-testid="order-warehouse">
          <TeamSelect
            teamType={TeamType.WAREHOUSE}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </Box>
      </Flex>
    </Box>
  );
}
