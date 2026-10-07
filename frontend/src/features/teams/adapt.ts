import { create } from "@bufbuild/protobuf";

import {
  TeamByIdsDataType,
  type TeamByIdsResponse,
  TeamListDataType,
  type TeamListResponseItem,
  type Team,
  type TeamRowItem,
  TeamSchema,
} from "../../gen/warehouse/team/v1/team_pb";

// TeamList and TeamByIds moved to the guideline list/by-ids shape (per-id slices + sorted ids / a map
// keyed by id). The team screens and the many cross-service resolvers still want Team objects, so
// these adapters rebuild them from the TEAM (row) slice at the query boundary. TeamByIds is the
// anti-join primitive used across the app, so `teamsByIds` returns a `{ [id]: Team }` map — the same
// access shape the old `.data` field had.

export const teamListRowData = (): TeamListDataType[] => [TeamListDataType.TEAM];
export const teamByIdsRowData = (): TeamByIdsDataType[] => [TeamByIdsDataType.TEAM];

function rowToTeam(r: TeamRowItem): Team {
  // create() fills the rest (info undefined) — a list/by-ids row never carries TeamInfo.
  return create(TeamSchema, {
    id: r.id,
    type: r.type,
    name: r.name,
    teamCode: r.teamCode,
    description: r.description,
    deleted: r.deleted,
    imageUrl: r.imageUrl,
  });
}

// teamsFromList rebuilds Team[] from a list response, in the response's sorted id order.
export function teamsFromList(items: TeamListResponseItem[], ids: bigint[]): Team[] {
  let rowMap: { [key: string]: TeamRowItem } = {};
  for (const it of items) {
    if (it.d.case === "team") {
      rowMap = it.d.value.mapData;
    }
  }

  const out: Team[] = [];
  for (const id of ids) {
    const r = rowMap[id.toString()];
    if (r) out.push(rowToTeam(r));
  }

  return out;
}

// teamsByIds rebuilds a { [idString]: Team } map from a by-ids response — the same access shape the
// old `.data` map had. Unknown/soft-deleted ids are simply absent (check presence, don't index blind).
export function teamsByIds(res: TeamByIdsResponse): { [key: string]: Team } {
  const out: { [key: string]: Team } = {};

  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "team") {
        const r = it.d.value.mapData[id];
        if (r) out[id] = rowToTeam(r);
      }
    }
  }

  return out;
}
