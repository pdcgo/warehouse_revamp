import {
  type PublicUser,
  type TeamAccessItem,
  type TeamAccessListResponseItem,
  TeamAccessDataType,
  type TeamMemberLogEntry,
  type TeamMemberLogListResponseItem,
  type User,
  UserByIdsDataType,
  type UserMembership,
  type UserByIDsResponse,
  UserListDataType,
  type UserListResponseItem,
} from "../../gen/warehouse/user/v1/user_pb";

// UserList / UserByIDs / TeamAccessList / UserTeams moved to the guideline list/by-ids shape. The
// USER / PUBLIC_USER / TEAM_ACCESS slices reuse the User / PublicUser / TeamAccessItem messages
// directly, so these adapters just pull the slice values out of the items/ids envelope at the query
// boundary — the screens keep their existing shapes.

export const userListRowData = (): UserListDataType[] => [UserListDataType.USER];
// The member list also asks for each person's role in the scoped team (USER_LIST_DATA_TYPE_MEMBERSHIP).
// ⚠ The server returns no such slice until the user decisions are built, so the map comes back empty.
export const memberListRowData = (): UserListDataType[] => [UserListDataType.USER, UserListDataType.MEMBERSHIP];
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

// membershipsFromList pulls the MEMBERSHIP slice out of a list response: user id → their place in the
// scoped team. Empty when the server did not send the slice.
export function membershipsFromList(items: UserListResponseItem[]): Map<string, UserMembership> {
  const out = new Map<string, UserMembership>();
  for (const it of items) {
    if (it.d.case === "membership") {
      for (const [id, m] of Object.entries(it.d.value.mapData)) {
        out.set(id, m);
      }
    }
  }

  return out;
}

// logEntriesFromList rebuilds the membership log in the response's sorted id order (newest first).
export function logEntriesFromList(items: TeamMemberLogListResponseItem[], ids: bigint[]): TeamMemberLogEntry[] {
  let rowMap: { [key: string]: TeamMemberLogEntry } = {};
  for (const it of items) {
    if (it.d.case === "entry") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: TeamMemberLogEntry[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(r);
  }

  return out;
}
