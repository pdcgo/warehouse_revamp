import { HoldScreen, type HoldRow } from "../_financials/HoldScreen";

// Held funds BY TEAM — how much cash each team is waiting on, across all its shops.
//
// A different question from the shop view, not a different screen: the shop view is used to CHASE a
// specific hold; this one is used to understand why a team's cash position is worse than its sales
// suggest. Same rows, aggregated one level up.
export const description =
  "Held funds by team — how much cash each team is waiting on across all its shops. Used to explain a cash position, where the shop view is used to chase a specific hold.";

export interface FinancialsHoldTeamPageProps {
  rows: HoldRow[];
  loading?: boolean;
  isError?: boolean;
}

export function FinancialsHoldTeamPage({ rows, loading, isError }: FinancialsHoldTeamPageProps) {
  return (
    <HoldScreen
      subjectLabel="Team"
      title="Held funds by team"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
