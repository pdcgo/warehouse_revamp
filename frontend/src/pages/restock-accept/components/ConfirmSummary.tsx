import { Flex, HStack, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { ExpiryCell } from "../../../features/inventory/ExpiryCell";
import { formatRupiahNumber } from "../../../lib/money";
import { PcsMark } from "./PcsMark";

// WHAT TERIMA IS ABOUT TO DO, IN FIGURES — the confirm dialog's body (owner: *"2 oke"*, the confirm-says-the-count):
//
//   Baik [16 pcs]   Rusak [1 pcs]   Kurang [1 pcs]
//   Ongkir COD dibayar gudang  Rp 15.000
//   Barang baik masuk ke penempatan yang dipilih, … Ini tidak dapat dibatalkan.
//
// The last thing read before a count that cannot be undone is its numbers, not a sentence about them. Each figure is in
// its tone once it is above 0, grey at 0 — the same tones as the line's own figures.
export function ConfirmSummary({
  good,
  broken,
  missing,
  charge,
  expiries,
}: {
  good: bigint;
  broken: bigint;
  missing: bigint;
  charge: number;
  /** Each line's expiry, in the page's order — `unix` 0 for none (a line with no good unit sends none). */
  expiries: { productId: bigint; name: string; unix: bigint }[];
}) {
  const { t } = useTranslation();
  const pcs = (n: bigint) => t("restock.accept.pcs", { n: n.toString() });

  return (
    <Stack gap="3" data-testid="accept-confirm-summary">
      <Flex gap="4" wrap="wrap">
        <Figure label={t("restock.accept.confirm.good")} tone={good > 0n ? "success" : "gray"} testId="accept-confirm-good">
          {pcs(good)}
        </Figure>
        <Figure label={t("restock.problem.broken")} tone={broken > 0n ? "error" : "gray"} testId="accept-confirm-broken">
          {pcs(broken)}
        </Figure>
        <Figure label={t("restock.problem.missing")} tone={missing > 0n ? "warning" : "gray"} testId="accept-confirm-missing">
          {pcs(missing)}
        </Figure>
      </Flex>

      <HStack gap="2" wrap="wrap" data-testid="accept-confirm-charge">
        {charge > 0 ? (
          <>
            <Text fontSize="sm">{t("restock.accept.confirm.charge")}</Text>
            <Text fontSize="sm" fontWeight="bold" whiteSpace="nowrap">
              {formatRupiahNumber(charge)}
            </Text>
          </>
        ) : (
          <Text fontSize="sm" color="fg.muted">
            {t("restock.accept.courier.none")}
          </Text>
        )}
      </HStack>

      {/* EACH LINE'S EXPIRY (the-warehouse-types-the-expiry-at-the-accept): the date the batch it mints will carry, read
          as the batch screens' phone line reads it — *29 Nov · 20 hari lagi* — or a dash for none. */}
      {expiries.length > 0 && (
        <Stack gap="1" borderTopWidth="1px" borderColor="border" pt="3" data-testid="accept-confirm-expiry">
          <Text fontSize="sm" fontWeight="bold">
            {t("restock.accept.expiry.label")}
          </Text>
          {expiries.map((e) => (
            <Flex key={e.productId.toString()} gap="3" align="baseline" data-testid={`accept-confirm-expiry-${e.productId}`}>
              <Text fontSize="sm" truncate minW="0" flex="1">
                {e.name}
              </Text>
              <ExpiryCell inline fontSize="sm" unix={e.unix} testId={`accept-confirm-expiry-${e.productId}-day`} />
            </Flex>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function Figure({ label, tone, testId, children }: { label: string; tone: string; testId: string; children: string }) {
  return (
    <HStack gap="1.5">
      <Text fontSize="sm" fontWeight="bold">
        {label}
      </Text>
      <PcsMark tone={tone} testId={testId}>
        {children}
      </PcsMark>
    </HStack>
  );
}
