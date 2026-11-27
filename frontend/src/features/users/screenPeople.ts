import { create } from "@bufbuild/protobuf";
import { PublicUserSchema, type PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { personName } from "../../lib/users";

// ONE SCREEN'S PEOPLE, NAMED BY ONE READ (#133) — the pure half of `useScreenPeople` / `useNamedPeople`
// (features/users/queries.ts): what a part says it names, and how a who filter picks its people out of the one answer.
// Kept apart from the hooks so the rules are unit-tested without a client.

/** The one read of a screen's people, as its parts see it. */
export interface ScreenPeople {
  /** The people by id (as a string); `undefined` until the read has answered, or when it failed. */
  byId: Map<string, PublicUser> | undefined;
  /** Every part has answered and the read is done — named, failed, or nobody to name. */
  settled: boolean;
  /** `byId` is the LAST union's answer, kept while the new one is read. */
  kept: boolean;
}

/** An id user_service could not name, as a who filter keeps it: "#7". */
export function unnamed(id: bigint): PublicUser {
  return create(PublicUserSchema, { id, username: id.toString(), name: `#${id}` });
}

/** A `useScreenPeople` part: the ids a read's answer names — `undefined` while it is out, `[]` when it failed. */
export function idsOnceRead<T>(
  read: { data: T | undefined; isError: boolean },
  ids: (data: T) => readonly bigint[],
): readonly bigint[] | undefined {
  if (read.data !== undefined) return ids(read.data);

  return read.isError ? [] : undefined;
}

// A WHO FILTER'S PEOPLE out of the screen's one read — what `peopleFor` answered: the list service's ids in its order, an
// id the read could not name kept as "#7" (a filter that silently drops a person can no longer find their rows).
// `undefined` while they load, and while a new union is still out for ids the kept answer never named (the warehouse
// list's role switched), so the picker never offers "#7" for someone about to be named. `byName` sorts them A to Z (the
// shop list's primaries).
export function namedPeople(
  ids: readonly bigint[] | undefined,
  people: ScreenPeople,
  order?: "byName",
): PublicUser[] | undefined {
  const { byId, settled, kept } = people;

  if (ids === undefined || !settled) return undefined;
  if (kept && ids.some((id) => !byId?.has(id.toString()))) return undefined;

  const named = ids.map((id) => byId?.get(id.toString()) ?? unnamed(id));

  return order === "byName" ? named.sort((a, b) => personName(a).localeCompare(personName(b))) : named;
}
