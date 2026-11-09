import { useMemo } from "react";
import { useExpensePeople } from "../expense/queries";
import { useOrderCreators } from "../orders/queries";
import { useSettlementPeople } from "../settlement/queries";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import type { MetricDef } from "./catalogue";

// One empty list for every render — a fresh `[]` is a new identity, and PersonFilterSelect's fill effect would loop on it.
const NOBODY: PublicUser[] = [];

export interface AnalyticPeople {
  /** The people on the rows of the chosen metrics, the latest first; `undefined` while they load. */
  people: PublicUser[] | undefined;
  /** A service could not say who is on its rows — the field says so rather than reading as nobody. */
  error: boolean;
}

// WHO THE ANALYTIC "CREATED BY" FILTER OFFERS (a-who-filter-lists-the-people-on-its-rows): the people on the rows of the
// metrics on the screen, each service answering for its own rows — selling's order creators (OrderCreatorList),
// settlement's people (SettlementPersonList), expense's typists and correctors (ExpensePersonList, told which expense
// metrics are on the table: Ads expense alone offers only its ads' people) — and never the system-wide user search, which
// only Root and the Administrator may call, so the field was dead for everyone else. Whoever reads the metric may filter
// it (whoever-reads-a-list-may-filter-it); former and suspended people are kept (a-filter-keeps-former-and-suspended-people).
//
// When several services' metrics share the table, their sets are UNIONED by id — order creators first, in their order,
// then any settlement person not among them, then any expense person not among either. A metric still served from
// sample figures names nobody.
export function useAnalyticPeople(teamId: bigint | undefined, metrics: Pick<MetricDef, "service" | "metricId">[]): AnalyticPeople {
  const wantsOrders = metrics.some((m) => m.service === "selling");
  const wantsSettlement = metrics.some((m) => m.service === "settlement");
  const expenseMetricIds = metrics.filter((m) => m.service === "expense").map((m) => m.metricId);
  const wantsExpense = expenseMetricIds.length > 0;

  const creators = useOrderCreators({ teamId, enabled: wantsOrders });
  const settlementPeople = useSettlementPeople({ teamId, enabled: wantsSettlement });
  const expensePeople = useExpensePeople({ teamId, metricIds: expenseMetricIds, enabled: wantsExpense });

  const orderData = wantsOrders ? creators.data : NOBODY;
  const settlementData = wantsSettlement ? settlementPeople.data : NOBODY;
  const expenseData = wantsExpense ? expensePeople.data : NOBODY;
  const error =
    (wantsOrders && creators.isError) || (wantsSettlement && settlementPeople.isError) || (wantsExpense && expensePeople.isError);

  // Memoised on the three answers, so the field receives ONE list identity until any of them changes.
  const people = useMemo(() => {
    if (orderData === undefined || settlementData === undefined || expenseData === undefined) {
      return undefined;
    }

    // Only sample metrics on the table: nobody is on real rows yet.
    if (orderData === NOBODY && settlementData === NOBODY && expenseData === NOBODY) {
      return NOBODY;
    }

    const seen = new Set<string>();
    const union: PublicUser[] = [];

    for (const person of [...orderData, ...settlementData, ...expenseData]) {
      const id = person.id.toString();
      if (seen.has(id)) continue;

      seen.add(id);
      union.push(person);
    }

    return union;
  }, [orderData, settlementData, expenseData]);

  // A failed read ends the wait: the field says it could not read the people rather than spinning forever.
  if (error && people === undefined) {
    return { people: NOBODY, error };
  }

  return { people, error };
}
