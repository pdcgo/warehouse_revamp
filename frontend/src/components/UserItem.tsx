import type { ReactNode } from "react";
import { Avatar, HStack, Stack, Text } from "@chakra-ui/react";
import type { PublicUser } from "../gen/warehouse/user/v1/user_pb";

export interface UserItemProps {
  // Any user-shaped object — a PublicUser, a User, whatever carries these fields.
  user: Pick<PublicUser, "name" | "username" | "avatarUrl">;
  // Optional trailing content: a role badge, action buttons, etc.
  action?: ReactNode;
  size?: "sm" | "md";
}

// UserItem is the shared way to show a user in a list, a menu, a search result (#41): their avatar
// (falling back to initials), display name, and @username. Everything that renders "a user" should
// use this so avatars and naming stay consistent across the app.
export function UserItem({ user, action, size = "sm" }: UserItemProps) {
  const display = user.name || user.username;

  return (
    <HStack gap="card" w="full">
      <Avatar.Root size={size} colorPalette="brand" flexShrink={0}>
        <Avatar.Fallback name={display} />
        <Avatar.Image src={user.avatarUrl || undefined} alt={display} />
      </Avatar.Root>

      <Stack gap="0" flex="1" minW="0">
        <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
          {display}
        </Text>
        <Text fontSize="xs" color="fg.muted" lineClamp={1}>
          @{user.username}
        </Text>
      </Stack>

      {action}
    </HStack>
  );
}
