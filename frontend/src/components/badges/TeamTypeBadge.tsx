import { Badge, type BadgeProps } from "@chakra-ui/react";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";

// How a TEAM TYPE is shown, in one place: its name, its badge, and the tint of a team's initials
// avatar. The colours live in theme.ts (`teamType.<type>.*`, TEAM TYPE COLOURS); this only picks which.
//
// A person works across several teams and switches between them constantly, so the type has to read at
// a glance — and every place that shows it (TeamItem, TeamSelect, TeamSwitcher, TeamTypeSelect, the
// legacy TeamTypeBadge) goes through here. Two copies of this mapping had already drifted once: the
// switcher painted the root team a different colour from the team list.

function teamTypeKey(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "warehouse";
    case TeamType.SELLING:
      return "selling";
    case TeamType.ROOT:
      return "root";
    case TeamType.ADMIN:
      return "admin";
    default:
      return "others";
  }
}

// teamTypeLabel is the shared display name for a team type — the badge's text, the picker's options,
// and any caller that shows a type read-only.
export function teamTypeLabel(type: TeamType | undefined): string {
  switch (type) {
    case TeamType.ROOT:
      return "Root";
    case TeamType.ADMIN:
      return "Admin";
    case TeamType.WAREHOUSE:
      return "Warehouse";
    case TeamType.SELLING:
      return "Selling";
    default:
      return "Team";
  }
}

// The team-type tint for a team's initials avatar, as style props for `Avatar.Root`. A step deeper
// than the badge, the way Chakra tints an avatar (`muted`) against a badge (`subtle`).
export function teamTypeAvatar(type: TeamType | undefined): { bg: string; color: string } {
  const key = teamTypeKey(type);
  return { bg: `teamType.${key}.avatar`, color: `teamType.${key}.fg` };
}

export const description =
  "A team's type (Warehouse / Selling / Root / Admin) as a badge in its standard colour, for light and dark mode.";

export interface TeamTypeBadgeProps extends Omit<BadgeProps, "bg" | "color" | "colorPalette" | "children"> {
  type?: TeamType;
}

export function TeamTypeBadge({ type, ...rest }: TeamTypeBadgeProps) {
  const key = teamTypeKey(type);

  return (
    <Badge
      bg={`teamType.${key}.badge`}
      color={`teamType.${key}.fg`}
      data-testid={`team-type-badge-${type ?? TeamType.UNSPECIFIED}`}
      {...rest}
    >
      {teamTypeLabel(type)}
    </Badge>
  );
}
