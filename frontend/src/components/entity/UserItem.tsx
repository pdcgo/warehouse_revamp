import type { ReactNode } from "react";
import { Avatar, Badge, HStack, Stack, Text } from "@chakra-ui/react";
import { useTranslation } from "react-i18next";
import type { PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import type { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { roleLabel } from "../../lib/roles";
import { formerUserId } from "../../lib/users";

export interface UserItemProps {
  // Any user-shaped object — a PublicUser, a User, whatever carries these fields.
  user: Pick<PublicUser, "name" | "username" | "avatarUrl">;
  // Optionally show the user's role as a badge (e.g. their role in a team).
  role?: Role;
  // The type of the team the role is held in — the admin team's two roles read differently from the
  // selling team's until they are renamed (the-two-administrators-have-distinct-labels).
  teamType?: TeamType;
  // Optional trailing content: action buttons, a check, etc.
  action?: ReactNode;
  size?: "sm" | "md";
}

// UserItem is the shared way to show a user in a list, a menu, a search result (#41): their avatar
// (falling back to initials), display name, @username, and — optionally — a role badge. Everything
// that renders "a user" should use this so avatars and naming stay consistent across the app.
export const description =
  "The shared way to show a user — avatar (or initials), display name, and @username. An erased account reads as a former user.";

export function UserItem({ user, role, teamType, action, size = "sm" }: UserItemProps) {
  const { t } = useTranslation();

  // An erased account (erase-keeps-the-row) is "Former user #57": its username is synthetic, so it is not shown.
  const formerId = formerUserId(user);
  const display = formerId ? t("users.formerUser", { id: formerId }) : user.name || user.username;
  const showRole = role !== undefined && role !== Role.UNSPECIFIED;

  return (
    <HStack gap="card" w="full">
      <Avatar.Root size={size} colorPalette="brand" flexShrink={0}>
        <Avatar.Fallback name={display} />
        <Avatar.Image src={user.avatarUrl || undefined} alt={display} />
      </Avatar.Root>

      <Stack gap="0.5" flex="1" minW="0">
        <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
          {display}
        </Text>
        <HStack gap="2">
          {!formerId && (
            <Text fontSize="xs" color="fg.muted" lineClamp={1}>
              @{user.username}
            </Text>
          )}
          {showRole && (
            <Badge colorPalette="brand" size="xs">
              {roleLabel(role, teamType)}
            </Badge>
          )}
        </HStack>
      </Stack>

      {action}
    </HStack>
  );
}
