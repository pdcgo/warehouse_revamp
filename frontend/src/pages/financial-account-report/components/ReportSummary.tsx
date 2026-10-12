import { useTranslation } from "react-i18next";
import { Button, Icon, Span } from "@chakra-ui/react";
import { ChevronRight } from "lucide-react";

import type { Metric } from "../../../features/financialAccount/analytics";
import { ProviderBadge } from "../../../features/financialAccount/badges";
import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import { dateInputToUnix, formatUnixDate } from "../../../lib/datetime";
import { formatRupiahNumber } from "../../../lib/money";
import { signed } from "./MetricColumns";
import type { Mover } from "./MoversDialog";

/** A movement, signed and coloured — green in, red out, as on every statement. */
export function SignedAmount({ amount }: { amount: number }) {
  return (
    <Span color={amount > 0 ? "fg.success" : amount < 0 ? "fg.error" : undefined} whiteSpace="nowrap">
      {signed(amount)}
    </Span>
  );
}

/** A balance — red below zero (below-zero-is-warned-never-refused). */
function Balance({ amount }: { amount: number | undefined }) {
  if (amount === undefined) return <>—</>;

  return <Span color={amount < 0 ? "fg.error" : undefined}>{formatRupiahNumber(amount)}</Span>;
}

// THE REPORT'S FIVE CARDS (owner, `the-report-is-five-cards-and-one-table`), as the order list's card strip, each saying
// what its figure is (owner: *"saldo awal kasih tanggal mulai, perubahan bersih dan saldo akhir entahlah isinya enaknya
// apa dibawah, tapi saldo akhir bisa dikasih keterangan saldo awal + perubahan"*):
//
//   Saldo awal        the day it is the balance at the start of
//   Perubahan bersih  how big the move was against where it started — the one thing the two balances do not say —
//                     and "Rincian ›" at the end of its label row, which opens what it is made of
//   Saldo akhir       the day it is the balance at the end of, and that it IS the opening plus the change
//
//   Akun · Penyedia   WHAT MOVED IT, by account and by provider (owner: *"yang menggerakannya bisa jadi statistic juga …
//                     jadi nambah 2 statistik akun dan provider"*, account first): the one that moved most, out of how
//                     many, and "Rincian ›" opening them all. Not drawn while one account is picked (owner: *"keduanya
//                     jadi tidak perlu muncul kalau ada filter akun"*) — one account has nothing to rank, and the
//                     contract's ranking cannot be narrowed to it.
//
// A card stays a card: only the word "Rincian" is pressed (as on the settlement margin card).
export function ReportSummary({
  metric,
  from,
  to,
  onDetail,
  movers,
  onMovers,
}: {
  metric: Metric | undefined;
  from: string;
  to: string;
  onDetail: () => void;
  /** The ranked accounts and providers — undefined while one account is picked, and the two cards are not drawn. */
  movers?: { account: Mover[] | undefined; provider: Mover[] | undefined };
  onMovers: (kind: "account" | "provider") => void;
}) {
  const { t, i18n } = useTranslation();

  const day = (d: string) => formatUnixDate(dateInputToUnix(d, false));
  // Against the opening balance — nothing to measure against when it opened at zero or below.
  const share =
    metric && metric.openBalance > 0
      ? new Intl.NumberFormat(i18n.language, { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(
          metric.change / metric.openBalance,
        )
      : undefined;

  const details = (onClick: () => void, testId: string) => (
    <Button variant="plain" size="2xs" h="auto" p="0" ms="auto" color="brand.fg" fontWeight="bold" onClick={onClick} data-testid={testId}>
      {t("financialAccounts.report.seeDetail")}
      <Icon as={ChevronRight} boxSize="3" />
    </Button>
  );

  // The one that moved most is first — the server ranks by the size of the change.
  const moverCard = (kind: "account" | "provider", rows: Mover[] | undefined) => {
    const top = rows?.[0];

    return (
      <SummaryCard
        key={kind}
        label={t(`financialAccounts.report.by.${kind}`)}
        mark={rows && rows.length > 0 ? details(() => onMovers(kind), `account-report-by-${kind}-detail`) : undefined}
        value={top ? <SignedAmount amount={top.change} /> : "—"}
        // A provider is named by its coloured badge, as everywhere else — recognised before it is read.
        line={kind === "provider" && top?.provider !== undefined ? <ProviderBadge provider={top.provider} /> : top?.name}
        note={
          rows
            ? t(kind === "account" ? "financialAccounts.report.topOfAccounts" : "financialAccounts.report.topOfProviders", {
                count: rows.length,
              })
            : undefined
        }
        // `by-` — `account-report-account` is the account filter's own field.
        testId={`account-report-by-${kind}`}
      />
    );
  };

  return (
    <SummaryStrip testId="account-report-totals">
      <SummaryCard
        label={t("financialAccounts.report.open")}
        value={<Balance amount={metric?.openBalance} />}
        line={from ? t("financialAccounts.report.openAt", { date: day(from) }) : undefined}
        testId="account-report-open"
      />
      <SummaryCard
        label={t("financialAccounts.report.change")}
        mark={details(onDetail, "account-report-change-detail")}
        value={metric ? <SignedAmount amount={metric.change} /> : "—"}
        line={share ? t("financialAccounts.report.ofOpen", { share }) : undefined}
        testId="account-report-change"
      />
      <SummaryCard
        label={t("financialAccounts.report.close")}
        value={<Balance amount={metric?.closeBalance} />}
        line={to ? t("financialAccounts.report.closeAt", { date: day(to) }) : undefined}
        note={t("financialAccounts.report.closeIs")}
        emphasis
        testId="account-report-close"
      />
      {movers && moverCard("account", movers.account)}
      {movers && moverCard("provider", movers.provider)}
    </SummaryStrip>
  );
}
