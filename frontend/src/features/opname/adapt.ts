import {
  OpnameDraftType,
  type OpnameRack,
  type OpnameRackListResponseItem,
  type OpnameRow,
  type OpnameRowListResponseItem,
  type OpnameSession,
  type OpnameSessionListResponseItem,
} from "../../gen/warehouse/inventory/v1/opname_pb";

// The stock count's three lists speak the guideline's list shape (guidelines/service-guideline.md); each pulls its
// rows out at the boundary, in `ids` order.

export function sessionsFromList(items: OpnameSessionListResponseItem[], ids: bigint[]): OpnameSession[] {
  let m: { [key: string]: OpnameSession } = {};
  for (const it of items) if (it.d.case === "session") m = it.d.value.mapData;

  return ids.map((id) => m[id.toString()]).filter((r): r is OpnameSession => !!r);
}

export function rowsFromList(items: OpnameRowListResponseItem[], ids: bigint[]): OpnameRow[] {
  let m: { [key: string]: OpnameRow } = {};
  for (const it of items) if (it.d.case === "row") m = it.d.value.mapData;

  return ids.map((id) => m[id.toString()]).filter((r): r is OpnameRow => !!r);
}

export function racksFromList(items: OpnameRackListResponseItem[], ids: bigint[]): OpnameRack[] {
  let m: { [key: string]: OpnameRack } = {};
  for (const it of items) if (it.d.case === "rack") m = it.d.value.mapData;

  return ids.map((id) => m[id.toString()]).filter((r): r is OpnameRack => !!r);
}

/** count − book, once revealed; 0 before. */
export const differenceOf = (row: OpnameRow): bigint =>
  row.revealed ? row.recountedStockCount - row.systemStockCount : 0n;

export const draftOf = (row: OpnameRow, type: OpnameDraftType) => row.drafts.find((d) => d.type === type);

// The lost draft follows the broken one: the shortage less the broken, at least 0
// (a-short-rack-gets-a-lost-draft-from-the-system). Worked out on screen as staff type, the way the server does.
export function lostAfterBroken(row: OpnameRow, broken: bigint): bigint {
  const short = row.systemStockCount - row.recountedStockCount;
  const lost = short - broken;

  return lost > 0n ? lost : 0n;
}

export const surplusOf = (row: OpnameRow): bigint => {
  const over = row.recountedStockCount - row.systemStockCount;

  return over > 0n ? over : 0n;
};
