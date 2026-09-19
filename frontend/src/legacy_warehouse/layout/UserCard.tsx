import { Avatar, Badge, Box, HStack, Stack, Text, Wrap } from "@chakra-ui/react";
import { SkeletonBlock } from "../../legacy/components/feedback/SkeletonBlock";

// ── WHO IS SIGNED IN, PINNED TO THE TOP OF THE SIDEBAR ──────────────────────────────────────────
//
// It looks like decoration. It is not, and the reason is specific to a warehouse: THE TABLET IS
// SHARED. It sits on a trolley or a bench, several people use it across a shift, and nobody signs
// out — so "who am I acting as right now" is a question the operator genuinely has, and every
// movement they record is attributed to whoever the last person left signed in.
//
// So the name is large, always visible, and never behind an avatar menu. The roles are visible for
// the same reason: they explain why a screen the operator expected is not in the menu.
export interface FloorUser {
  name: string;
  email?: string;
  roles: string[];
  avatarUrl?: string;
}

export interface UserCardProps {
  user?: FloorUser;
}

export function UserCard({ user }: UserCardProps) {
  return (
    <HStack gap="3" px="4" py="3" bg="bg.subtle" borderBottomWidth="1px" align="start" data-testid="user-card">
      <Avatar.Root size="md" borderRadius="md">
        <Avatar.Fallback name={user?.name} />
        {user?.avatarUrl && <Avatar.Image src={user.avatarUrl} />}
      </Avatar.Root>

      <Stack gap="0.5" flex="1" minW="0">
        {user ? (
          <>
            <Text fontSize="sm" fontWeight="semibold" textTransform="uppercase" lineClamp={1}>
              {user.name}
            </Text>
            {user.email && (
              <Text fontSize="xs" color="fg.muted" lineClamp={1}>
                {user.email}
              </Text>
            )}
            <Wrap gap="1" mt="0.5">
              {user.roles.map((role) => (
                <Badge key={role} size="xs" variant="outline" textTransform="capitalize" data-testid="user-role">
                  {role}
                </Badge>
              ))}
            </Wrap>
          </>
        ) : (
          // ⚠ SKELETON, NOT A BLANK. An empty user card on a shared tablet reads as "signed out",
          // and the operator's next move is to sign in over somebody else's session.
          // The id goes on a wrapper, not on SkeletonBlock: SkeletonBlock already owns the id
          // `skeleton-block`, and what a caller wants to assert here is the CARD's state.
          <Box data-testid="user-card-loading">
            <SkeletonBlock lines={2} />
          </Box>
        )}
      </Stack>
    </HStack>
  );
}
