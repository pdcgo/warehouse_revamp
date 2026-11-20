import { describe, expect, it } from "vitest";

import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { activeRoute, isMenuGroup, menuFor } from "./nav";

// CUSTOM SHIPMENTS SIT IN INVENTORIES, RIGHT AFTER TRANSFER, ON BOTH SIDES (owner,
// custom-shipments-sit-in-inventories-after-transfer). nav.ts builds both shells' menus (the sidebar and the phone's
// menu sheet), so the one place to pin the line's place is here.

function inventoriesOf(teamType: TeamType, role: Role) {
  const group = menuFor(teamType, role).find((entry) => isMenuGroup(entry) && entry.label === "nav.inventories");
  if (!group || !isMenuGroup(group)) throw new Error("no Inventories group");

  return group.children.map((item) => item.to);
}

describe("the custom shipments menu line", () => {
  it.each([
    ["a selling team", TeamType.SELLING, Role.SELLING_OWNER],
    ["a selling team's CS", TeamType.SELLING, Role.SELLING_CS],
    ["a warehouse", TeamType.WAREHOUSE, Role.WAREHOUSE_ADMIN],
    ["a warehouse's staff", TeamType.WAREHOUSE, Role.WAREHOUSE_STAFF],
  ])("sits right after Transfer for %s", (_who, teamType, role) => {
    const links = inventoriesOf(teamType, role);

    expect(links).toContain("/inventories/custom-shipments");
    expect(links.indexOf("/inventories/custom-shipments")).toBe(links.indexOf("/inventories/transfer") + 1);
  });

  it("stays lit on a parcel's page and on the create form (the longest prefix)", () => {
    const menu = menuFor(TeamType.SELLING, Role.SELLING_OWNER);

    expect(activeRoute(menu, "/inventories/custom-shipments/new")).toBe("/inventories/custom-shipments");
    expect(activeRoute(menu, "/inventories/custom-shipments/804")).toBe("/inventories/custom-shipments");
    expect(activeRoute(menu, "/inventories/transfer/3101")).toBe("/inventories/transfer");
  });
});
