import { TeamType } from "../../../gen/warehouse/team/v1/team_pb";
import { teamTypeLabel } from "../../../components/pickers/TeamTypeSelect";
import type { Tone } from "../tone";
import { ToneBadge, type ToneBadgeProps } from "./ToneBadge";

// The STANDARD tone per team type. A person works across several teams and switches between them
// constantly, so the type needs to be readable at a glance from the badge alone — the switcher, the
// team table and every scoped header render through this one mapping.
function teamTypeTone(type: TeamType | undefined): Tone {
  switch (type) {
    case TeamType.SELLING:
      return "primary";
    case TeamType.WAREHOUSE:
      return "warning";
    case TeamType.ROOT:
      return "success";
    case TeamType.ADMIN:
      return "error";
    default:
      return "plain";
  }
}

// TeamTypeBadge renders a team's type as a standard-toned badge.
export const description =
  "A team's type (Selling / Warehouse / Root / Admin) as a standard-toned badge.";

export interface TeamTypeBadgeProps extends Omit<ToneBadgeProps, "tone" | "children"> {
  type?: TeamType;
}

export function TeamTypeBadge({ type, ...rest }: TeamTypeBadgeProps) {
  return (
    <ToneBadge
      tone={teamTypeTone(type)}
      data-testid={`team-type-badge-${type ?? TeamType.UNSPECIFIED}`}
      {...rest}
    >
      {teamTypeLabel(type ?? TeamType.UNSPECIFIED)}
    </ToneBadge>
  );
}
