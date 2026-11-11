import type { ReactNode } from "react";
import { Avatar, HStack, Stack, Text } from "@chakra-ui/react";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge, teamTypeAvatar } from "../badges/TeamTypeBadge";

export interface TeamItemProps {
  // Any team-shaped object with a name, type, and (optionally) id and picture — a Team or a
  // TeamAccessItem. `imageUrl` is only present on shapes that carry it (a Team); TeamAccessItem
  // has none, so those fall back to initials.
  team: { teamName?: string; teamType?: TeamType; teamId?: bigint; imageUrl?: string };
  // Optional trailing content: a check, actions, etc.
  action?: ReactNode;
  /** `xs` — a small avatar and the name alone, for a dense fact list (a restock's Terima). UserItem's `xs`, for a team. */
  size?: "xs" | "sm";
}

// TeamItem is the shared way to show a team (#42): a rounded avatar (name initials), the team name,
// and a type badge coloured by team type. Everything that renders "a team" should use this so team
// display stays consistent.
export const description =
  "The shared way to show a team — avatar, name, and a type badge coloured per type. `xs`: a small avatar and the name alone.";

export function TeamItem({ team, action, size = "sm" }: TeamItemProps) {
  const name = team.teamName || (team.teamId !== undefined ? `Team #${team.teamId}` : "Team");

  // THE SMALL ONE (owner, on Terima: *"id restok, tim dan usernya simpel saja, gambarnya kecil"*) — the avatar at its
  // smallest, still tinted by type, and the name on one line; no badge.
  if (size === "xs") {
    return (
      <HStack gap="1.5" minW="0">
        <Avatar.Root shape="rounded" size="2xs" {...teamTypeAvatar(team.teamType)} flexShrink={0}>
          <Avatar.Fallback name={name} />
          <Avatar.Image src={team.imageUrl || undefined} alt={name} />
        </Avatar.Root>
        <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
          {name}
        </Text>
        {action}
      </HStack>
    );
  }

  return (
    <HStack gap="card" w="full">
      {/* Avatar and badge are both tinted by team type — TeamTypeBadge owns the colours. */}
      <Avatar.Root shape="rounded" size="sm" {...teamTypeAvatar(team.teamType)} flexShrink={0}>
        <Avatar.Fallback name={name} />
        <Avatar.Image src={team.imageUrl || undefined} alt={name} />
      </Avatar.Root>

      <Stack gap="0.5" flex="1" minW="0">
        <Text fontWeight="medium" lineClamp={1} textAlign="start">
          {name}
        </Text>
        <TeamTypeBadge type={team.teamType} size="sm" alignSelf="flex-start" />
      </Stack>

      {action}
    </HStack>
  );
}
