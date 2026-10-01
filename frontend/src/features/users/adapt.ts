import {
  type PublicUser,
  type TeamAccessItem,
  type TeamAccessListResponseItem,
  TeamAccessDataType,
  type User,
  UserByIdsDataType,
  type UserByIDsResponse,
  UserListDataType,
  type UserListResponseItem,
} from "../../gen/warehouse/user/v1/user_pb";

// UserList / UserByIDs / TeamAccessList / UserTeams moved to the guideline list/by-ids shape. The
// USER / PUBLIC_USER / TEAM_ACCESS slices reuse the User / PublicUser / TeamAccessItem messages
// directly, so these adapters just pull the slice values out of the items/ids envelope at the query
// boundary — the screens keep their existing shapes.

export const userListRowData = (): UserListDataType[] => [UserListDataType.USER];
export const userByIdsRowData = (): UserByIdsDataType[] => [UserByIdsDataType.PUBLIC_USER];
export const teamAccessRowData = (): TeamAccessDataType[] => [TeamAccessDataType.TEAM_ACCESS];

// usersFromList rebuilds User[] from a list response, in the response's sorted id order.
export function usersFromList(items: UserListResponseItem[], ids: bigint[]): User[] {
  let rowMap: { [key: string]: User } = {};
  for (const it of items) {
    if (it.d.case === "user") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: User[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}

// publicUsersByIds rebuilds a { [idString]: PublicUser } map from a by-ids response — the same access
// shape the old `.data` map had.
export function publicUsersByIds(res: UserByIDsResponse): { [key: string]: PublicUser } {
  const out: { [key: string]: PublicUser } = {};
  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "publicUser") {
        const r = it.d.value.mapData[id];
        if (r) out[id] = r;
      }
    }
  }

  return out;
}

// teamAccessFromList rebuilds TeamAccessItem[] from a membership-list response (TeamAccessList and
// UserTeams share it), in the response's sorted id order.
export function teamAccessFromList(
  items: TeamAccessListResponseItem[],
  ids: bigint[],
): TeamAccessItem[] {
  let rowMap: { [key: string]: TeamAccessItem } = {};
  for (const it of items) {
    if (it.d.case === "teamAccess") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: TeamAccessItem[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}
