import {
  TeamTypeBadge as SharedTeamTypeBadge,
  type TeamTypeBadgeProps as SharedTeamTypeBadgeProps,
} from "../../../components/badges/TeamTypeBadge";

// The adopted-legacy name for the live design system's TeamTypeBadge (components/badges).
//
// It used to map each type to a legacy TONE — a second colour table for the same fact, which is how
// the switcher and the team list had already come to disagree about the root team. It now renders the
// shared badge, so a legacy screen and a live one show a team type identically, from the one mapping
// in theme.ts (`teamType.*`).
export const description =
  "A team's type (Selling / Warehouse / Root / Admin) as a standard-coloured badge — renders the live TeamTypeBadge.";

export type TeamTypeBadgeProps = SharedTeamTypeBadgeProps;

export function TeamTypeBadge(props: TeamTypeBadgeProps) {
  return <SharedTeamTypeBadge {...props} />;
}
