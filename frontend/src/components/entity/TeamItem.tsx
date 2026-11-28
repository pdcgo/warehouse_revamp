import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, Button, HStack, Stack, Text } from "@chakra-ui/react";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { TeamTypeBadge, teamTypeAvatar } from "../badges/TeamTypeBadge";

export interface TeamItemProps {
  // Any team-shaped object with a name, type, and (optionally) id and picture — a Team or a
  // TeamAccessItem. `imageUrl` is only present on shapes that carry it (a Team); TeamAccessItem
  // has none, so those fall back to initials.
  team: { teamName?: string; teamType?: TeamType; teamId?: bigint; imageUrl?: string };
  // Optional trailing content: a check, actions, etc.
  action?: ReactNode;
  /**
   * `xs` — a small avatar and the name alone, for a dense fact list (a restock's Terima). UserItem's `xs`, for a team.
   * `sm` (default) — the avatar, the name and the type badge.
   * `md` / `lg` — the team at a PRODUCT'S size, beside one in a card: `ProductListItem`'s own `md` / `lg` avatar and name,
   * no badge, and `caption` under the name where the product has its code — so the two halves of a card weigh the same.
   */
  size?: "xs" | "sm" | "md" | "lg";
  /** `md` / `lg` only — the line under the name, where a product beside it shows its code (*Pemilik*). */
  caption?: ReactNode;
  /**
   * Makes the PICTURE a button that opens it big (a-small-picture-opens-its-preview) — as `ProductListItem`'s
   * `onImageClick`. Only a team that HAS a picture gets one: initials have nothing to open. Omit it and the avatar is
   * static, as on every screen that does not ask.
   */
  onImageClick?: () => void;
}

// TeamItem is the shared way to show a team (#42): a rounded avatar (name initials), the team name,
// and a type badge coloured by team type. Everything that renders "a team" should use this so team
// display stays consistent.
export const description =
  "The shared way to show a team — avatar, name, and a type badge coloured per type. `xs`: a small avatar and the name alone. `md` / `lg`: the team at a product's size (ProductListItem's `md` / `lg` avatar and name), no badge, a `caption` under the name — for a card that holds a product and its owner side by side. Pass `onImageClick` and a team's picture becomes a button that opens it big; initials stay static.";

export function TeamItem({ team, action, size = "sm", caption, onImageClick }: TeamItemProps) {
  const { t } = useTranslation();
  const name = team.teamName || (team.teamId !== undefined ? `Team #${team.teamId}` : "Team");

  const avatarSize = size === "lg" ? "2xl" : size === "md" ? "md" : size === "xs" ? "2xs" : "sm";
  const avatar = (
    <Avatar.Root shape="rounded" size={avatarSize} {...teamTypeAvatar(team.teamType)} flexShrink={0}>
      <Avatar.Fallback name={name} />
      <Avatar.Image src={team.imageUrl || undefined} alt={name} />
    </Avatar.Root>
  );

  // ⚠ A REAL BUTTON WHEN IT OPENS SOMETHING, AND NOTHING EXTRA WHEN IT DOES NOT — ProductListItem's rule: an `onClick` on
  // a box is unreachable by keyboard and silent to a screen reader. A team with no picture keeps the bare avatar.
  const picture =
    onImageClick && team.imageUrl ? (
      <Button
        type="button"
        variant="plain"
        p="0"
        h="auto"
        minW="auto"
        flexShrink={0}
        cursor="zoom-in"
        aria-label={t("teamItem.viewImage", { name })}
        data-testid={`team-item-image-${team.teamId ?? ""}`}
        onClick={onImageClick}
      >
        {avatar}
      </Button>
    ) : (
      avatar
    );

  // AT A PRODUCT'S SIZE (owner, on a batch's product card: *"secara besar tidak balance, pemilik terlihat kecil"*,
  // the-owner-weighs-the-same-as-its-product) — the avatar and the name ProductListItem draws at the same size, and a
  // caption where it has the code. No badge: a card that pairs a team with a product already says what the team is.
  if (size === "md" || size === "lg") {
    const large = size === "lg";

    return (
      <HStack gap="card" minW="0">
        {picture}
        <Stack gap="0.5" minW="0">
          <Text fontWeight="medium" fontSize={large ? "lg" : undefined} lineClamp={1} textAlign="start">
            {name}
          </Text>
          {caption && (
            <Text fontSize="xs" color="fg.muted" lineClamp={1}>
              {caption}
            </Text>
          )}
        </Stack>
        {action}
      </HStack>
    );
  }

  // THE SMALL ONE (owner, on Terima: *"id restok, tim dan usernya simpel saja, gambarnya kecil"*) — the avatar at its
  // smallest, still tinted by type, and the name on one line; no badge.
  if (size === "xs") {
    return (
      <HStack gap="1.5" minW="0">
        {picture}
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
      {picture}

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
