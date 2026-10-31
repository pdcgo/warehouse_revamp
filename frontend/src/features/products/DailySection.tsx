import { useTranslation } from "react-i18next";
import { HStack, Stack, Table, Text } from "@chakra-ui/react";

import { useIsMobile } from "../../layouts/shell";
import { formatUnixDate } from "../../lib/datetime";
import type { SampleDay } from "./dailySample";

// A ROW LIGHTS UP under the pointer, every cell of it (a-table-row-lights-up).
const LIGHTS_UP = { _hover: { "& > td": { bg: "bg.muted" } } } as const;

// KELUAR MASUK HARIAN — per day: what came in, what went out, and what was on hand at the end of it. The read for "how
// fast does this go" that the movement list answers only by counting. The chosen warehouse's, under its tab
// (the-warehouse-zone-is-tabs) — on the product's own page and its discover detail alike (the-discover-detail-has-the-
// warehouse-zone). ⚠ The rows are SAMPLES until the server sums the movements per day (each page's pending.ts `daily`).
export function DailySection({ days }: { days: SampleDay[] }) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const pcs = (n: number) => t("products.stat.pcs", { n });

  if (isMobile) {
    // A PHONE READS EACH DAY AS A LINE — the date, then in and out and what was left.
    return (
      <Stack gap="0" data-testid="pd-daily-table">
        {days.map((d, i) => (
          <HStack
            key={i}
            justify="space-between"
            py="2"
            borderBottomWidth="1px"
            borderColor="border.muted"
            fontSize="sm"
            data-testid={`pd-daily-row-${i}`}
          >
            <Text>{formatUnixDate(d.dayUnix)}</Text>
            <HStack gap="3">
              <Text color={d.inQty > 0 ? "success.fg" : "fg.subtle"}>+{d.inQty}</Text>
              <Text color={d.outQty > 0 ? "error.fg" : "fg.subtle"}>−{d.outQty}</Text>
              <Text fontWeight="bold" minW="16" textAlign="end">
                {pcs(d.balance)}
              </Text>
            </HStack>
          </HStack>
        ))}
      </Stack>
    );
  }

  return (
    <Table.Root size="sm" data-testid="pd-daily-table">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>{t("products.detail.daily.date")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.in")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.out")}</Table.ColumnHeader>
          <Table.ColumnHeader textAlign="end">{t("products.detail.daily.balance")}</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {days.map((d, i) => (
          <Table.Row key={i} css={LIGHTS_UP} data-testid={`pd-daily-row-${i}`}>
            <Table.Cell>{formatUnixDate(d.dayUnix)}</Table.Cell>
            <Table.Cell textAlign="end" color={d.inQty > 0 ? "success.fg" : "fg.subtle"}>
              {d.inQty > 0 ? `+${pcs(d.inQty)}` : "—"}
            </Table.Cell>
            <Table.Cell textAlign="end" color={d.outQty > 0 ? "error.fg" : "fg.subtle"}>
              {d.outQty > 0 ? `−${pcs(d.outQty)}` : "—"}
            </Table.Cell>
            <Table.Cell textAlign="end" fontWeight="bold">
              {pcs(d.balance)}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
}
