import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { PublicUserSchema, type PublicUser } from "../../gen/warehouse/user/v1/user_pb";
import { idsOnceRead, namedPeople, type ScreenPeople } from "./screenPeople";

// ONE SCREEN'S PEOPLE, NAMED BY ONE READ (#133) — what each part of a list screen says it names, and how a who filter
// picks its people out of the one UserByIDs answer.

const person = (id: bigint, name: string): PublicUser => create(PublicUserSchema, { id, username: name.toLowerCase(), name });
const ANI = person(61n, "Ani");
const EKO = person(65n, "Eko");
const BUDI = person(62n, "Budi");
const byId = (...people: PublicUser[]) => new Map(people.map((p) => [p.id.toString(), p]));
const answered = (map: Map<string, PublicUser> | undefined): ScreenPeople => ({ byId: map, settled: true, kept: false });

describe("idsOnceRead", () => {
  it("names the answer's ids once the read has answered", () => {
    expect(idsOnceRead({ data: { rows: [7n, 8n] }, isError: false }, (d) => d.rows)).toEqual([7n, 8n]);
  });

  it("names nobody when the read failed, so the others are still named", () => {
    expect(idsOnceRead<{ rows: bigint[] }>({ data: undefined, isError: true }, (d) => d.rows)).toEqual([]);
  });

  it("is not known yet while the read is out", () => {
    expect(idsOnceRead<{ rows: bigint[] }>({ data: undefined, isError: false }, (d) => d.rows)).toBeUndefined();
  });
});

describe("namedPeople", () => {
  it("is the list service's ids in its order, named from the one read", () => {
    expect(namedPeople([65n, 61n], answered(byId(ANI, EKO)))?.map((p) => p.name)).toEqual(["Eko", "Ani"]);
  });

  it("keeps an id the read could not name as #7 — never drops it", () => {
    const named = namedPeople([61n, 7n], answered(byId(ANI)));

    expect(named?.map((p) => p.name)).toEqual(["Ani", "#7"]);
    expect(named?.[1]?.id).toBe(7n);
  });

  it("keeps every id as #id when the read failed", () => {
    expect(namedPeople([61n, 65n], answered(undefined))?.map((p) => p.name)).toEqual(["#61", "#65"]);
  });

  it("is loading while its ids or the read are out", () => {
    expect(namedPeople(undefined, answered(byId(ANI)))).toBeUndefined();
    expect(namedPeople([61n], { byId: undefined, settled: false, kept: false })).toBeUndefined();
  });

  it("keeps showing the kept answer's people while a new union is read for others", () => {
    expect(namedPeople([61n, 65n], { byId: byId(ANI, EKO), settled: true, kept: true })?.map((p) => p.name)).toEqual([
      "Ani",
      "Eko",
    ]);
  });

  it("is loading, never #id, for someone the kept answer never named while the new union is out", () => {
    expect(namedPeople([61n, 62n], { byId: byId(ANI), settled: true, kept: true })).toBeUndefined();
  });

  it("sorts A to Z when asked (the shop list's primaries)", () => {
    expect(namedPeople([65n, 62n, 61n], answered(byId(ANI, EKO, BUDI)), "byName")?.map((p) => p.name)).toEqual([
      "Ani",
      "Budi",
      "Eko",
    ]);
    expect(namedPeople([65n, 62n, 61n], answered(byId(ANI, EKO, BUDI)))?.map((p) => p.name)).toEqual([
      "Eko",
      "Budi",
      "Ani",
    ]);
  });
});
