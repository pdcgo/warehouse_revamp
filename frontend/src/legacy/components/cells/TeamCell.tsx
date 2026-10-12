import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge } from "../badges/TeamTypeBadge";
import { EntityCell } from "./EntityCell";

export interface TeamCellData {
  id?: bigint | number;
  name?: string;
  type?: TeamType;
}

// TeamCell is how a team appears in a table row: its name, with its TYPE badged underneath.
//
// The type is load-bearing, not ornament. What a row MEANS depends on it — a balance against a
// selling team is money owed to the warehouse, the same figure against a warehouse team is
// something else entirely — and the names give no clue which kind you are looking at. On any screen
// that mixes them (balances, transfers, the admin team list) the badge is the only thing separating
// two rows that otherwise read identically.
export const description =
  "A team in a table row: name plus its type badge — the type being what decides what the row's numbers actually mean.";

export interface TeamCellProps {
  team?: TeamCellData;
  teamId?: bigint | number;
  loading?: boolean;
}

export function TeamCell({ team, teamId, loading }: TeamCellProps) {
  const id = team?.id ?? teamId;

  return (
    <EntityCell
      loading={loading && !team}
      name={team?.name}
      fallback={id !== undefined ? `#${id}` : undefined}
      secondary={
        team?.type !== undefined && team.type !== TeamType.UNSPECIFIED ? (
          <TeamTypeBadge type={team.type} width="fit-content" />
        ) : undefined
      }
    />
  );
}
