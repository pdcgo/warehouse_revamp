import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@chakra-ui/react";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { marker, routedPage } from "../../../.storybook/pageStory";
import { teamClient, warehouseInfoClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { TeamUpdateResponseSchema } from "../../gen/warehouse/team/v1/team_pb";
import {
  WarehouseClosureDeleteResponseSchema,
  WarehouseInfoDetailResponseSchema,
  WarehouseInfoUpdateResponseSchema,
} from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";
import { WarehouseEditPage } from "./index";

// EDIT A WAREHOUSE (/teams/:teamId/edit) — its name and description (team_service) and its profile: the location, the
// two weekly schedules and the one-off closures (warehouse_service, WarehouseInfoDetail).
//
// The profile is ONE read a load (#122): the form and the closures list draw from the same query, where they used to
// ask for it twice. The form is seeded from it ONCE — the closures below re-read the profile after every write, and that
// answer must never overwrite what somebody is typing. The stub's profile is served by a spy here (warehouseInfoStub
// answers an empty one): Gudang Pusat (11) on Jl. Gudang 1, closed for Idul Fitri — and, from its second answer on, for
// a stock-take too, so a story can SEE that the re-read landed.

const WAREHOUSE = 11n;
let profileAnswers = 0;
// The holiday deleted through the page (WarehouseClosureDelete, spied) — gone from every answer after.
let holidayDeleted = false;

function profileOf(answer: number) {
  return create(WarehouseInfoDetailResponseSchema, {
    info: {
      teamId: WAREHOUSE,
      location: "Jl. Gudang 1, Bekasi",
      operatingHours: [],
      receivingHours: [],
      closures: [
        ...(holidayDeleted
          ? []
          : [{ id: 1n, warehouseId: WAREHOUSE, firstDay: "2026-12-24", lastDay: "2026-12-26", reason: "Idul Fitri" }]),
        ...(answer > 1 ? [{ id: 2n, warehouseId: WAREHOUSE, firstDay: "2027-01-05", lastDay: "2027-01-05", reason: "Stock opname" }] : []),
      ],
    },
  });
}

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

// A story-only control standing in for "something else made the profile stale" — a closure saved, another tab's edit:
// it invalidates the warehouse's profile and the teams, as those writes do, so both reads answer again.
function StoryReread() {
  const client = useQueryClient();

  return (
    <Button
      size="xs"
      mt="4"
      data-testid="story-reread"
      onClick={() =>
        void Promise.all([
          client.invalidateQueries({ queryKey: key.warehouseInfo(WAREHOUSE) }),
          client.invalidateQueries({ queryKey: ["teams"] }),
        ])
      }
    >
      Read the warehouse again
    </Button>
  );
}

const AtGudangPusat = routedPage(
  [
    {
      path: "/teams/:teamId/edit",
      element: (
        <>
          <WarehouseEditPage />
          <StoryReread />
        </>
      ),
    },
    marker("/teams/:teamId", "at-team-detail"),
  ],
  `/teams/${WAREHOUSE}/edit`,
);

const meta = {
  title: "Pages/Teams/WarehouseEditPage",
  component: AtGudangPusat,
  parameters: { signedIn: true, dataRouter: true },
  beforeEach: () => {
    profileAnswers = 0;
    holidayDeleted = false;
    const profile = spyOn(warehouseInfoClient, "warehouseInfoDetail").mockImplementation(async () => {
      profileAnswers += 1;
      return profileOf(profileAnswers);
    });
    const team = spyOn(teamClient, "teamDetail");
    const teamSave = spyOn(teamClient, "teamUpdate").mockImplementation(async () => create(TeamUpdateResponseSchema, {}));
    const infoSave = spyOn(warehouseInfoClient, "warehouseInfoUpdate").mockImplementation(async () =>
      create(WarehouseInfoUpdateResponseSchema, {}),
    );
    const closureDelete = spyOn(warehouseInfoClient, "warehouseClosureDelete").mockImplementation(async () => {
      holidayDeleted = true;
      return create(WarehouseClosureDeleteResponseSchema, {});
    });

    return () => {
      profile.mockRestore();
      team.mockRestore();
      teamSave.mockRestore();
      infoSave.mockRestore();
      closureDelete.mockRestore();
    };
  },
} satisfies Meta<typeof AtGudangPusat>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The form seeded from the two reads, and the closures list drawn from the same profile. */
async function loaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const name = await canvas.findByTestId("warehouse-edit-name", {}, { timeout: 5000 });
  await waitFor(() => expect(name).toHaveValue("Gudang Pusat"));
  await waitFor(() => expect(canvas.getByTestId("warehouse-edit-location")).toHaveValue("Jl. Gudang 1, Bekasi"));
  await waitFor(() => expect(canvas.getByTestId("warehouse-closure-1")).toBeVisible(), { timeout: 5000 });
  return canvas;
}

/** A controlled field typed from empty — slowly enough that no keystroke is dropped. */
async function retype(field: HTMLElement, text: string) {
  await userEvent.clear(field);
  await userEvent.type(field, text, { delay: 30 });
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** Gudang Pusat as stored: its name, its address, its holiday. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
  },
};

export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * ONE WarehouseInfoDetail A LOAD (#122) — the form's address and hours and the closures list come from the same read.
 * The closures list used to ask for the profile again once the form had loaded (the speed audit's duplicate).
 */
export const ReadsItsProfileOnce: Story = {
  name: "Reads the warehouse's profile once — the form and the closures from one WarehouseInfoDetail",
  play: async ({ canvasElement }) => {
    await loaded(canvasElement);
    // Long enough for a second reader mounted after the form to have asked.
    await new Promise((resolve) => setTimeout(resolve, 400));

    await expect(callsOf(warehouseInfoClient.warehouseInfoDetail)).toBe(1);
    await expect(callsOf(teamClient.teamDetail)).toBe(1);
  },
};

/**
 * A RE-READ NEVER OVERWRITES WHAT WAS TYPED (useSeedOnce). The profile answers again — here with a second closure, which
 * the list shows — and the name and address being typed stay exactly as typed.
 */
export const ARereadKeepsWhatWasTyped: Story = {
  name: "A re-read of the warehouse keeps what was typed — only the closures list moves",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await retype(canvas.getByTestId("warehouse-edit-name"), "Gudang Utama");
    await retype(canvas.getByTestId("warehouse-edit-location"), "Jl. Baru 7");

    await userEvent.click(canvas.getByTestId("story-reread"));
    // The re-read landed: both reads answered again, and the list shows the closure the second answer carries.
    await waitFor(() => expect(canvas.getByTestId("warehouse-closure-2")).toBeVisible(), { timeout: 5000 });
    await waitFor(() => expect(callsOf(teamClient.teamDetail)).toBe(2));

    await expect(canvas.getByTestId("warehouse-edit-name")).toHaveValue("Gudang Utama");
    await expect(canvas.getByTestId("warehouse-edit-location")).toHaveValue("Jl. Baru 7");
  },
};

/**
 * A SAVE ASKS NOTHING MORE OF THIS PAGE. It invalidates the teams and the warehouse's profile and leaves for the team's
 * page, which reads both afresh — the edit page's own reads sit still while it runs, so neither is asked twice.
 */
export const ASaveAsksNothingMoreHere: Story = {
  name: "A save re-reads nothing on the edit page before it leaves",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await retype(canvas.getByTestId("warehouse-edit-name"), "Gudang Utama");
    await userEvent.click(canvas.getByTestId("warehouse-edit-save"));

    await waitFor(() => expect(canvas.getByTestId("at-team-detail")).toBeVisible(), { timeout: 5000 });
    await expect(callsOf(teamClient.teamUpdate)).toBe(1);
    await expect(callsOf(warehouseInfoClient.warehouseInfoUpdate)).toBe(1);
    await expect(callsOf(teamClient.teamDetail)).toBe(1);
    await expect(callsOf(warehouseInfoClient.warehouseInfoDetail)).toBe(1);
  },
};

/**
 * A CLOSURE WRITE RE-READS THE PROFILE — the list follows it from the page's one read (ClosuresEditor invalidates the
 * warehouse's `warehouseInfo` key: its profile and its receiving state), and the form keeps what was typed.
 */
export const AClosureDeletedLeavesTheList: Story = {
  name: "A closure deleted leaves the list — the profile read again, the form as typed",
  play: async ({ canvasElement }) => {
    const canvas = await loaded(canvasElement);

    await retype(canvas.getByTestId("warehouse-edit-name"), "Gudang Utama");
    await userEvent.click(canvas.getByTestId("warehouse-closure-delete-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-action")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.queryByTestId("warehouse-closure-1")).toBeNull(), { timeout: 5000 });
    await expect(callsOf(warehouseInfoClient.warehouseClosureDelete)).toBe(1);
    await expect(canvas.getByTestId("warehouse-edit-name")).toHaveValue("Gudang Utama");
  },
};
