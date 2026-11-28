import { useTranslation } from "react-i18next";
import { Badge, HStack, Span, Stack, Text } from "@chakra-ui/react";

import { daysUntilUnix, formatUnixDate, formatUnixDateShort } from "../../lib/datetime";

// The "expiring soon" window the server uses — 30 days.
const SOON_DAYS = 30;

// The band as a badge's palette — the same three the words are coloured by.
const BADGE_PALETTE = { past: "error", soon: "warning", later: "gray" } as const;

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
  leftAsBadge = false,
  testId,
}: {
  unix: bigint;
  inline?: boolean;
  /** 12px beside a table's *Tiba*; a batch's Info reads it at its facts' own size — `inherit`. */
  fontSize?: "xs" | "sm" | "md" | "inherit";
  /**
   * How long is left as a BADGE in its band's colour, beside the day — a batch's Info (owner: *"hari tersisa buat jadi
   * badge"*, the-expiry-left-is-a-badge). The list keeps its coloured words.
   */
  leftAsBadge?: boolean;
  testId?: string;
}) {
  if (unix <= 0n) {
    return (
      <Text fontSize={fontSize} color="fg.muted" data-testid={testId}>
        —
      </Text>
    );
  }

  const date = (
    <Span whiteSpace="nowrap" title={formatUnixDate(unix)} data-testid={testId}>
      {formatUnixDateShort(unix)}
    </Span>
  );
  const remaining = <ExpiryLeft unix={unix} asBadge={leftAsBadge} testId={testId ? `${testId}-left` : undefined} />;

  // The day, and the badge beside it — no dot between: the badge's own edge parts them.
  if (inline && leftAsBadge) {
    return (
      <HStack as="span" display="inline-flex" gap="2" fontSize={fontSize} verticalAlign="middle">
        {date}
        {remaining}
      </HStack>
    );
  }

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

/**
 * HOW LONG IS LEFT, alone — *20 hari lagi*, *hari ini*, *lewat 3 hari* — in its band's colour (amber within the soon
 * window, red once past, quiet beyond; an-expiry-says-how-long-is-left). ExpiryCell draws it under the day; a form that
 * already shows the day (the restock accept's expiry picker) draws it beside the picker. Its size is the parent's.
 */
export function ExpiryLeft({ unix, asBadge = false, testId }: { unix: bigint; asBadge?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const days = daysUntilUnix(unix);
  const { color, key } = band(days);
  const left =
    days < 0
      ? t("batches.expiry.ago", { count: -days })
      : days === 0
        ? t("batches.expiry.today")
        : t("batches.expiry.left", { count: days });

  // AS A BADGE (the-expiry-left-is-a-badge) — a status, so its colour is the band's ROLE: red past, amber soon, grey later.
  if (asBadge) {
    return (
      <Badge colorPalette={BADGE_PALETTE[key]} variant="subtle" whiteSpace="nowrap" data-testid={testId} data-band={key}>
        {left}
      </Badge>
    );
  }

  return (
    <Span color={color} whiteSpace="nowrap" data-testid={testId} data-band={key}>
      {left}
    </Span>
  );
}
