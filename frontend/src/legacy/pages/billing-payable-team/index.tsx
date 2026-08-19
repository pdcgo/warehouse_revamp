import { BillingTeamScreen, teamDescription } from "../_billing/BillingScreens";
import type { TeamBalanceRow } from "../../financeFixtures";

// The payable team screen — the shared billing team view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = teamDescription;

export interface BillingPayableTeamPageProps {
  teams: TeamBalanceRow[];
  loading?: boolean;
}

export function BillingPayableTeamPage({ teams, loading }: BillingPayableTeamPageProps) {
  return <BillingTeamScreen direction="payable" teams={teams} loading={loading} />;
}
