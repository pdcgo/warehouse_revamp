import { Avatar, Text } from "@chakra-ui/react";
import { EntityCell } from "./EntityCell";

// Loose on purpose — the user shape differs between UserByIDs, a team member row and an audit
// actor, and none of them should have to build fields this cell never reads.
export interface UserCellData {
  id?: bigint | number;
  name?: string;
  username?: string;
  profilePicture?: string;
}

// UserCell is how a person appears in a table row: avatar, name, and @username underneath.
//
// The username matters more than it looks. Warehouse staff share given names — there are three
// people called Ani — so the display name alone is genuinely ambiguous on a members list, an audit
// trail or a "who picked this" column. The handle is the unique one, which is why it is part of the
// standard cell rather than something a screen adds when it remembers.
//
// The avatar falls back to INITIALS rather than a generic silhouette: most accounts have no photo,
// and a column of identical grey heads is a column carrying no information at all.
export const description =
  "A person in a table row: avatar (initials when there is no photo), name, and @username — the handle being what actually disambiguates staff who share a given name.";

export interface UserCellProps {
  user?: UserCellData;
  userId?: bigint | number;
  loading?: boolean;
}

export function UserCell({ user, userId, loading }: UserCellProps) {
  const id = user?.id ?? userId;

  return (
    <EntityCell
      loading={loading && !user}
      media={
        <Avatar.Root size="sm" flexShrink="0">
          <Avatar.Fallback name={user?.name} />
          {user?.profilePicture && <Avatar.Image src={user.profilePicture} alt={user.name} />}
        </Avatar.Root>
      }
      name={user?.name}
      fallback={id !== undefined ? `#${id}` : undefined}
      secondary={
        user?.username ? (
          <Text fontSize="xs" color="fg.muted" truncate data-testid="user-cell-username">
            @{user.username}
          </Text>
        ) : undefined
      }
    />
  );
}
