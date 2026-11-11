import { useTranslation } from "react-i18next";
import { Span, Stack, Text } from "@chakra-ui/react";

import { daysUntilUnix, formatUnixDate, formatUnixDateShort } from "../../lib/datetime";

// The "expiring soon" window the server uses — 30 days.
const SOON_DAYS = 30;

/** How near an expiry is: past, within the soon window, or later. */
function band(days: number): { color: string; key: "past" | "soon" | "later" } {
  if (days < 0) return { color: "error.fg", key: "past" };
  if (days <= SOON_DAYS) return { color: "warning.fg", key: "soon" };
  return { color: "fg.muted", key: "later" };
}

// A BATCH'S EXPIRY (owner: *"oke"*, an-expiry-says-how-long-is-left) — the DAY alone, as a table's date is short and an
// expiry has no clock (a-day-without-a-time-is-shown-alone), and under it how long is left, as the order list's ship-by
// deadline says it: one fact read twice, so one cell (one-context-per-column-and-never-three-lines).
//
//   27 Nov            12px, the size of Tiba beside it
//   18 hari lagi      amber within 30 days, red once past, quiet beyond; the full date on its hover
//
// `inline` puts both on one line — a phone's block: *27 Nov · 18 hari lagi*. No expiry is a dash.
//
// Two pages of one domain read it — the batch list's column and block, and a batch's Info (a-batch-page-is-one-page-of-
// sections) — so it lives in features/, not under the list's page.
export function ExpiryCell({
  unix,
  inline = false,
  fontSize = "xs",
  testId,
}: {
  unix: bigint;
  inline?: boolean;
  /** 12px beside a table's *Tiba*; a batch's Info reads it at a fact's size. */
  fontSize?: "xs" | "sm" | "md";
  testId?: string;
}) {
  const { t } = useTranslation();

  if (unix <= 0n) {
    return (
      <Text fontSize={fontSize} color="fg.muted" data-testid={testId}>
        —
      </Text>
    );
  }

  const days = daysUntilUnix(unix);
  const { color } = band(days);
  const left =
    days < 0
      ? t("batches.expiry.ago", { count: -days })
      : days === 0
        ? t("batches.expiry.today")
        : t("batches.expiry.left", { count: days });

  const date = (
    <Span whiteSpace="nowrap" title={formatUnixDate(unix)} data-testid={testId}>
      {formatUnixDateShort(unix)}
    </Span>
  );
  const remaining = (
    <Span color={color} whiteSpace="nowrap" data-testid={testId ? `${testId}-left` : undefined} data-band={band(days).key}>
      {left}
    </Span>
  );

  if (inline) {
    return (
      <Text fontSize={fontSize} as="span">
        {date}
        {" · "}
        {remaining}
      </Text>
    );
  }

  return (
    <Stack gap="0" fontSize={fontSize} align="start">
      {date}
      {remaining}
    </Stack>
  );
}
