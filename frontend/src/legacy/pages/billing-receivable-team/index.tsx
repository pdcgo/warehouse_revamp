import { BillingTeamScreen, teamDescription } from "../_billing/BillingScreens";
import type { TeamBalanceRow } from "../../financeFixtures";

// The receivable team screen — the shared billing team view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = teamDescription;

export interface BillingReceivableTeamPageProps {
  teams: TeamBalanceRow[];
  loading?: boolean;
}

export function BillingReceivableTeamPage({ teams, loading }: BillingReceivableTeamPageProps) {
  return <BillingTeamScreen direction="receivable" teams={teams} loading={loading} />;
}
