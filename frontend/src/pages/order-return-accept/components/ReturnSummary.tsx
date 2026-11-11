import { Card, Flex, Icon, SimpleGrid, Stack, Stat, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

import { useRackCodes } from "../../../features/racks/queries";

/** The accept's figures, summed over every line. */
export interface ReturnTotals {
  ordered: number;
  sound: number;
  broken: number;
  missing: number;
  /** Units of borrowed lines going on a shelf — one label each. */
  labels: number;
  /** Sound units by rack id — what goes where. */
  byRack: Map<string, number>;
}

// WHAT THIS ACCEPT DOES, before it is pressed — the three outcomes of a returned unit (return_decision.md):
//
//   on the shelf   the sound units, minted back at the order's cost, onto the racks named per line
//   thrown away    broken — a door row, borne by the selling team (a-broken-returned-unit-is-thrown-away-at-the-door)
//   missing        not in the box — a door row, borne by the selling team (a-short-return-is-missing-at-the-door)
//
// Neither door row is the warehouse's loss: it never reaches its payable or Inventory Lost. Both are named on the order's
// warehouse note so customer service can claim them from the platform — which is what the sentence under the figures says.
export function ReturnSummary({
  totals,
  warehouseId,
  sellingTeamName,
}: {
  totals: ReturnTotals;
  warehouseId: bigint;
  sellingTeamName: string;
}) {
  const { t } = useTranslation();
  const codes = useRackCodes({ warehouseId }).data ?? {};
  const lost = totals.broken + totals.missing;
  const racks = [...totals.byRack.entries()].filter(([, n]) => n > 0);

  return (
    <Card.Root data-testid="return-accept-summary">
      <Card.Body>
        <Stack gap="card">
          <SimpleGrid columns={{ base: 2, md: totals.labels > 0 ? 4 : 3 }} gap="card">
            <Stat.Root>
              <Stat.Label>{t("picking.returnAccept.summaryShelf")}</Stat.Label>
              <Stat.ValueText data-testid="return-accept-summary-shelf">{totals.sound}</Stat.ValueText>
              <Stat.HelpText data-testid="return-accept-summary-racks">
                {racks.length === 0
                  ? t("picking.returnAccept.summaryShelfOf", { count: totals.ordered })
                  : racks.map(([rack, n]) => `${codes[rack] ?? `#${rack}`} × ${n}`).join(" · ")}
              </Stat.HelpText>
            </Stat.Root>
            <Stat.Root>
              <Stat.Label>{t("picking.returnAccept.summaryThrown")}</Stat.Label>
              <Stat.ValueText
                color={totals.broken > 0 ? "warning.fg" : undefined}
                data-testid="return-accept-summary-thrown"
              >
                {totals.broken}
              </Stat.ValueText>
              <Stat.HelpText>{t("picking.returnAccept.summaryThrownHint")}</Stat.HelpText>
            </Stat.Root>
            <Stat.Root>
              <Stat.Label>{t("picking.returnAccept.summaryMissing")}</Stat.Label>
              <Stat.ValueText
                color={totals.missing > 0 ? "warning.fg" : undefined}
                data-testid="return-accept-summary-missing"
              >
                {totals.missing}
              </Stat.ValueText>
              <Stat.HelpText>{t("picking.returnAccept.summaryMissingHint")}</Stat.HelpText>
            </Stat.Root>
            {totals.labels > 0 && (
              <Stat.Root>
                <Stat.Label>{t("picking.returnAccept.summaryLabels")}</Stat.Label>
                <Stat.ValueText data-testid="return-accept-summary-labels">{totals.labels}</Stat.ValueText>
                <Stat.HelpText>{t("picking.returnAccept.summaryLabelsHint")}</Stat.HelpText>
              </Stat.Root>
            )}
          </SimpleGrid>

          <Flex gap="2" align="flex-start" color="fg.muted" data-testid="return-accept-summary-borne">
            <Icon as={Info} boxSize="4" mt="0.5" flexShrink={0} />
            <Text fontSize="sm">
              {lost > 0
                ? t("picking.returnAccept.borneBy", { count: lost, team: sellingTeamName })
                : t("picking.returnAccept.allSound")}
            </Text>
          </Flex>
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
