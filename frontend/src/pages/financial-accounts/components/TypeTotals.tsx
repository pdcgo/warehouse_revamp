import { useTranslation } from "react-i18next";
import { Span } from "@chakra-ui/react";

import { SummaryCard, SummaryStrip } from "../../../features/orders/SummaryCard";
import type { TypeTotal } from "../../../features/financialAccount/adapt";
import type { FinancialAccountType } from "../../../gen/warehouse/financial_account/v1/financial_account_pb";
import { TYPE_TOTAL_KEY } from "../../../features/financialAccount/vocab";
import { formatRupiahNumber } from "../../../lib/money";

// What the team holds, by type — bank, wallet, cash, and the money sitting in unknown accounts — and the
// whole of it. Active accounts only; an archived one holds zero by rule.
//
// Asked of the server (FinancialAccountOverview TYPE_TOTAL), never summed from the rows below: the list
// is paginated, and a total that summed the visible page would change as somebody turned it.
//
// THE ORDER LIST'S CARDS (owner, `the-accounts-totals-are-the-order-lists-cards`) — `SummaryStrip` of
// `SummaryCard`s, a label, one figure, a quiet line — per `a-list-summary-is-the-order-lists-card-strip`.
// A total below zero keeps its red (`below-zero-is-warned-never-refused`), and so does the count of
// accounts under zero on its line — it carries what the banner used to (`the-accounts-page-has-no-banners`).
//
// ONE CARD LEADS, in pale blue (owner, `the-total-leads-until-a-type-is-picked`): **Total saldo** while every
// type is shown, the picked type's card while the tabs narrow to one — the strip says which pile the table
// below is.
export function TypeTotals({
  totals,
  highlight,
}: {
  totals: TypeTotal[] | undefined;
  /** The type the tabs picked — its card leads. Undefined = all types, and the total leads. */
  highlight?: FinancialAccountType;
}) {
  const { t } = useTranslation();

  const all = totals ?? [];
  const team = all.reduce((sum, x) => sum + x.balance, 0);
  const accounts = all.reduce((sum, x) => sum + x.accountCount, 0);

  const money = (balance: number) =>
    balance < 0 ? <Span color="fg.error">{formatRupiahNumber(balance)}</Span> : formatRupiahNumber(balance);

  return (
    <SummaryStrip testId="account-totals">
      {/* THE TOTAL FIRST (owner, `the-total-saldo-comes-first`) — the whole, then what it is made of. */}
      <SummaryCard
        label={t("financialAccounts.totals.team")}
        value={totals ? money(team) : "—"}
        line={t("financialAccounts.totals.accounts", { count: accounts })}
        emphasis={highlight === undefined}
        testId="account-total-team"
      />

      {all.map((x) => (
        <SummaryCard
          key={x.type}
          label={t(TYPE_TOTAL_KEY[x.type] ?? "")}
          value={money(x.balance)}
          line={
            <>
              {t("financialAccounts.totals.accounts", { count: x.accountCount })}
              {x.belowZeroCount > 0 && (
                <Span color="fg.error" data-testid={`account-total-${x.type}-below-zero`}>
                  {` · ${t("financialAccounts.totals.belowZero", { count: x.belowZeroCount })}`}
                </Span>
              )}
            </>
          }
          emphasis={highlight === x.type}
          testId={`account-total-${x.type}`}
        />
      ))}

    </SummaryStrip>
  );
}
