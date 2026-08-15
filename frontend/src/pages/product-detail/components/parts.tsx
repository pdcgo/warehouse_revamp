import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";

import { TeamSelect } from "../../../components/pickers/TeamSelect";
import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { formatUnixDate } from "../../../lib/datetime";

// The small shared pieces of the product detail — the labelled field, the two "we do not know yet"
// renderers, and the warehouse lens. Used by the page's own Info panel and by all three tab panels
// beside this file, which is what makes them page components rather than one panel's.

// A labelled read-only field; a dash keeps the layout from collapsing on an empty value.
export function Field({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap="0.5" minW="0">
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" lineClamp={3}>
        {value || "—"}
      </Text>
    </Stack>
  );
}

// The same shape as Field, for a value that is a component rather than a string.
export function Stat({
  label,
  hint,
  testId,
  children,
}: {
  label: string;
  hint?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="0.5" minW="0" data-testid={testId}>
      <Text fontSize="xs" fontWeight="medium" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      <Text fontSize="sm" asChild>
        <div>{children}</div>
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.subtle">
          {hint}
        </Text>
      )}
    </Stack>
  );
}

// A figure whose read has not answered yet. It renders as a dash with the reason beside it rather
// than as a 0: an unknown figure is not a zero one (#74), and a screen that prints Rp 0 where it means
// "I could not find out" is worse than one that says so.
export function Pending() {
  const { t } = useTranslation();

  return (
    <HStack gap="1.5">
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
      <Text fontSize="xs" color="fg.subtle">
        {t("products.stat.pending")}
      </Text>
    </HStack>
  );
}

// A date, or "Never" — and, while the read is still in flight, neither. An undefined unix means the
// answer has not arrived; a 0 means it arrived and the answer is that this has never happened. They
// are different sentences and a screen that renders both as "Never" tells the second one as fact.
export function WhenOrNever({ unix }: { unix?: bigint }) {
  const { t } = useTranslation();

  if (unix === undefined) {
    return (
      <Text color="fg.subtle" data-testid="stock-unknown">
        —
      </Text>
    );
  }

  if (unix === 0n) {
    return <Text color="fg.muted">{t("products.stat.never")}</Text>;
  }

  return <Text>{formatUnixDate(unix)}</Text>;
}

// The WAREHOUSE LENS control, on each of the three tabs whose figures are per-warehouse.
//
// The shared TeamSelect restricted to WAREHOUSE teams — the same picker the product list uses, not a
// second dropdown of this page's own. It carries its own ✕, so there is no separate clear button.
export function WarehouseFilter({
  value,
  onChange,
  testId,
}: {
  value: bigint;
  onChange: (id: bigint) => void;
  testId: string;
}) {
  const { t } = useTranslation();

  return (
    <Box minW="16rem" data-testid={testId}>
      <TeamSelect
        value={value}
        onChange={onChange}
        teamType={TeamType.WAREHOUSE}
        placeholder={t("products.allWarehouses")}
      />
    </Box>
  );
}

// Choosing a warehouse RESTATES every figure below as that warehouse's — it does not merely hide
// rows. Saying so is the point: a stock number that quietly became one building's, while still
// looking like the total, is the way this screen could lie without a single wrong value on it.
export function WarehouseNote({
  warehouseId,
  warehouseName,
}: {
  warehouseId: bigint;
  warehouseName?: string;
}) {
  const { t } = useTranslation();

  if (warehouseId === 0n) {
    return null;
  }

  return (
    <Text fontSize="sm" color="fg.muted" data-testid="pd-warehouse-note">
      {t("products.detail.warehouseNote", {
        warehouse: warehouseName || `#${warehouseId}`,
      })}
    </Text>
  );
}
