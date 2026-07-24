import type { ReactNode } from "react";
import { Badge } from "./ui/Badge";
import type { BadgePalette } from "./ui/Badge";
import { cn } from "./ui/cn";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

// Each team type gets its own colour so the type is readable at a glance.
function typePalette(type: TeamType | undefined): BadgePalette {
  switch (type) {
    case TeamType.WAREHOUSE:
      return "blue";
    case TeamType.SELLING:
      return "green";
    case TeamType.ADMIN:
      return "purple";
    case TeamType.ROOT:
      return "gray";
    default:
      return "gray";
  }
}

// The tinted (subtle) avatar background per palette — the same tints the Badge uses, so a team's
// avatar and its type badge read as one colour.
const AVATAR_TINT: Record<BadgePalette, string> = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  green: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  orange: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  purple: "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  pink: "bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  cyan: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  yellow: "bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  gray: "bg-surface-2 text-fg-muted",
};

function typeLabel(type: TeamType | undefined): string {
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

export interface TeamItemProps {
  // Any team-shaped object with a name, type, and (optionally) id and picture — a Team or a
  // TeamAccessItem. `imageUrl` is only present on shapes that carry it (a Team); TeamAccessItem
  // has none, so those fall back to initials.
  team: { teamName?: string; teamType?: TeamType; teamId?: bigint; imageUrl?: string };
  // Optional trailing content: a check, actions, etc.
  action?: ReactNode;
}

// The first letter of the first and last word of a name, upper-cased — the avatar's fallback when
// there is no picture (or the picture fails to load). Mirrors what Chakra's Avatar derived for us.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

// TeamItem is the shared way to show a team (#42): a rounded avatar (name initials), the team name,
// and a type badge coloured by team type. Everything that renders "a team" should use this so team
// display stays consistent.
export const description = "The shared way to show a team — avatar, name, and a type badge coloured per type.";

export function TeamItem({ team, action }: TeamItemProps) {
  const name = team.teamName || (team.teamId !== undefined ? `Team #${team.teamId}` : "Team");
  const palette = typePalette(team.teamType);

  return (
    <div className="flex w-full items-center gap-card">
      {/* Avatar: a type-tinted rounded box showing initials, with the picture layered on top. The
          <img> hides itself if it fails to load, revealing the initials beneath. */}
      <div
        className={cn(
          "relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-control text-xs font-medium",
          AVATAR_TINT[palette],
        )}
      >
        <span>{initials(name)}</span>
        {team.imageUrl && (
          <img
            key={team.imageUrl}
            src={team.imageUrl}
            alt={name}
            className="absolute inset-0 size-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="line-clamp-1 text-start font-medium">{name}</p>
        <Badge colorPalette={palette} className="self-start">
          {typeLabel(team.teamType)}
        </Badge>
      </div>

      {action}
    </div>
  );
}
