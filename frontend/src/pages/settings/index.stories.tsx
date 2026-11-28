import type { Meta, StoryObj } from "@storybook/react-vite";
import { create } from "@bufbuild/protobuf";
import { expect, screen, spyOn, userEvent, waitFor, within } from "storybook/test";

import { asAdminTeam, asRole } from "../../../.storybook/sessionScenario";
import { asTeam } from "../../../.storybook/pageStory";
import { warehouseInfoClient } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import {
  WarehouseClosureAddResponseSchema,
  WarehouseClosureDeleteResponseSchema,
  WarehouseInfoDetailResponseSchema,
  WarehouseInfoUpdateResponseSchema,
  Weekday,
} from "../../gen/warehouse/warehouse/v1/warehouse_info_pb";
import { SettingsPage } from "./index";

// A WAREHOUSE'S OWN SETTINGS (the-warehouse-sets-its-own-hours-in-settings) — its Owner and Admin set the receiving
// hours, the operating hours, the closures and the location here, with the editors root's Teams → Edit warehouse uses;
// Staff get no editor. While the receiving hours are NOT SET the card says so first: a warehouse with none is not
// closed, so a seller's order shows it no warning (a-warehouse-with-no-hours-is-not-closed).
//
// The profile is served by spies (warehouseInfoStub answers an empty one and has no writes): Gudang Pusat (11) starts
// with NO hours, no location and no closures — a story's own `beforeEach` gives it hours — and every write lands in
// `profile`, so the re-read after a save answers what was saved.

const WAREHOUSE = 11n;

interface DayInit {
  weekday: Weekday;
  open: boolean;
  openTime: string;
  closeTime: string;
}

interface ClosureInit {
  id: bigint;
  warehouseId: bigint;
  firstDay: string;
  lastDay: string;
  reason: string;
}

let profile: { location: string; operatingHours: DayInit[]; receivingHours: DayInit[]; closures: ClosureInit[] };
let nextClosureId = 10n;

function noHours() {
  return { location: "", operatingHours: [], receivingHours: [], closures: [] };
}

/** The decisions' own grid: Mon–Sat 08:00–17:00, closed Sunday. */
function monToSat(): DayInit[] {
  const days = [Weekday.MONDAY, Weekday.TUESDAY, Weekday.WEDNESDAY, Weekday.THURSDAY, Weekday.FRIDAY, Weekday.SATURDAY];

  return [
    ...days.map((weekday) => ({ weekday, open: true, openTime: "08:00", closeTime: "17:00" })),
    { weekday: Weekday.SUNDAY, open: false, openTime: "", closeTime: "" },
  ];
}

function answer() {
  return create(WarehouseInfoDetailResponseSchema, { info: { teamId: WAREHOUSE, ...profile } });
}

/** How many times a spied client method has been called so far. */
function callsOf(method: unknown): number {
  return (method as { mock: { calls: unknown[] } }).mock.calls.length;
}

/** The last request a spied client method was called with. */
function lastCall<T>(method: unknown): T {
  const calls = (method as { mock: { calls: T[][] } }).mock.calls;
  return calls[calls.length - 1]![0]!;
}

/** Today in the browser's calendar, yyyy-mm-dd — the day the DatePicker opens on. */
function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const meta = {
  title: "Pages/Settings/SettingsPage",
  component: SettingsPage,
  parameters: {
    signedIn: true,
    // The narrowest phone nothing may run past (nothing-runs-past-a-phones-edge) — a story-file viewport, merged with
    // the workbench's own by the runner.
    viewport: { options: { phone320: { name: "Phone 320", styles: { width: "320px", height: "720px" }, type: "mobile" } } },
  },
  beforeEach: () => {
    asTeam(WAREHOUSE)();
    asRole(Role.WAREHOUSE_OWNER)();
    profile = noHours();
    nextClosureId = 10n;

    const detail = spyOn(warehouseInfoClient, "warehouseInfoDetail").mockImplementation(async () => answer());
    const update = spyOn(warehouseInfoClient, "warehouseInfoUpdate").mockImplementation(async (req) => {
      profile = {
        ...profile,
        location: req.location ?? "",
        operatingHours: (req.operatingHours ?? []) as DayInit[],
        receivingHours: (req.receivingHours ?? []) as DayInit[],
      };
      return create(WarehouseInfoUpdateResponseSchema, { info: { teamId: WAREHOUSE, ...profile } });
    });
    const add = spyOn(warehouseInfoClient, "warehouseClosureAdd").mockImplementation(async (req) => {
      const closure = {
        id: nextClosureId++,
        warehouseId: WAREHOUSE,
        firstDay: req.firstDay ?? "",
        lastDay: req.lastDay ?? "",
        reason: req.reason ?? "",
      };
      profile = { ...profile, closures: [...profile.closures, closure] };
      return create(WarehouseClosureAddResponseSchema, { closure });
    });
    const remove = spyOn(warehouseInfoClient, "warehouseClosureDelete").mockImplementation(async (req) => {
      profile = { ...profile, closures: profile.closures.filter((c) => c.id !== req.closureId) };
      return create(WarehouseClosureDeleteResponseSchema, {});
    });

    return () => {
      detail.mockRestore();
      update.mockRestore();
      add.mockRestore();
      remove.mockRestore();
    };
  },
} satisfies Meta<typeof SettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The hours card loaded: its form seeded from the one read of the profile. */
async function hoursLoaded(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("settings-warehouse-location")).toBeVisible(), { timeout: 5000 });
  await waitFor(() => expect(canvas.getByTestId("receiving-hours")).toBeVisible());
  return canvas;
}

/** A Settings page drawn far enough to judge what is NOT on it: the team name card, and the fee card of a warehouse. */
async function settingsDrawn(canvasElement: HTMLElement, warehouse = true) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(canvas.getByTestId("settings-team-name")).toBeVisible(), { timeout: 5000 });
  if (warehouse) {
    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-fee")).toBeVisible(), { timeout: 5000 });
  }
  // Long enough for a card mounted after the page to have drawn.
  await new Promise((resolve) => setTimeout(resolve, 300));
  return canvas;
}

function withHours() {
  profile = { ...noHours(), location: "Jl. Gudang 1, Bekasi", receivingHours: monToSat(), operatingHours: monToSat() };
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

/** The Owner of a warehouse with no hours set: the prompt first, then the same editors as Edit warehouse. */
export const Default: Story = {
  name: "No hours set — the owner is prompted to set them",
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-hours-prompt")).toBeVisible());
    await expect(canvas.getByTestId("operating-hours")).toBeVisible();
    await expect(canvas.getByTestId("warehouse-closures")).toBeVisible();
    await expect(canvas.getByTestId("warehouse-closures-empty")).toBeVisible();
    await expect(canvas.getByTestId("settings-warehouse-hours-save")).toBeEnabled();
  },
};

export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-hours-prompt")).toBeVisible());
  },
};

/** An Admin, hours set: no prompt, and the grids and the address as stored. */
export const HoursSet: Story = {
  name: "Hours set — no prompt, the grids and the address as stored",
  beforeEach: () => {
    asRole(Role.WAREHOUSE_ADMIN)();
    withHours();
  },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-location")).toHaveValue("Jl. Gudang 1, Bekasi"));
    await expect(canvas.queryByTestId("settings-warehouse-hours-prompt")).toBeNull();
    await expect(within(canvas.getByTestId("receiving-hours-open-1")).getByRole("checkbox")).toBeChecked();
    await expect(canvas.getByTestId("receiving-hours-from-1")).toHaveValue("08:00");
    await expect(canvas.getByTestId("receiving-hours-to-6")).toHaveValue("17:00");
    await expect(within(canvas.getByTestId("receiving-hours-open-7")).getByRole("checkbox")).not.toBeChecked();
    await expect(within(canvas.getByTestId("operating-hours-open-1")).getByRole("checkbox")).toBeChecked();
  },
};

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

/**
 * ON A 320px PHONE THE HOURS FIT THE SCREEN (nothing-runs-past-a-phones-edge) — in Indonesian, the longer copy, with every
 * weekday open: the shared weekly grid wraps its times under the day there, so nothing runs past the screen's edge.
 */
export const OnAPhoneTheHoursFitTheScreen: Story = {
  name: "On a 320px phone the hours fit the screen, in Indonesian",
  globals: { viewport: { value: "phone320" }, locale: "id" },
  beforeEach: () => {
    withHours();
  },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("receiving-hours-to-1")).toBeVisible());
    await expect(window.innerWidth).toBe(320);

    const past = Array.from(canvas.getByTestId("settings-warehouse-hours").querySelectorAll<HTMLElement>("*")).filter(
      (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > window.innerWidth + 0.5,
    );
    await expect(past.map((el) => el.dataset.testid ?? el.tagName)).toEqual([]);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

/** A week closed EVERY day is not a schedule anyone means — still "not set", still prompted. */
export const AWeekClosedEveryDayIsNotSet: Story = {
  name: "A week closed every day is not set — the prompt stays",
  beforeEach: () => {
    profile = {
      ...noHours(),
      receivingHours: monToSat().map((day) => ({ ...day, open: false, openTime: "", closeTime: "" })),
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-hours-prompt")).toBeVisible());
  },
};

/**
 * THE OWNER SETS THE RECEIVING HOURS — one WarehouseInfoUpdate carrying the grid and the address typed; the profile is
 * read again, and the prompt goes once the hours are stored. The form keeps what was typed.
 */
export const TheOwnerSetsTheReceivingHours: Story = {
  name: "The owner sets the receiving hours — saved, the prompt gone",
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-hours-prompt")).toBeVisible());

    await userEvent.click(within(canvas.getByTestId("receiving-hours-open-1")).getByRole("checkbox"));
    await waitFor(() => expect(canvas.getByTestId("receiving-hours-from-1")).toBeVisible());
    await userEvent.type(canvas.getByTestId("settings-warehouse-location"), "Jl. Baru 7", { delay: 30 });
    await userEvent.click(canvas.getByTestId("settings-warehouse-hours-save"));

    await waitFor(() => expect(callsOf(warehouseInfoClient.warehouseInfoUpdate)).toBe(1));
    const sent = lastCall<{ teamId: bigint; location: string; receivingHours: DayInit[] }>(
      warehouseInfoClient.warehouseInfoUpdate,
    );
    await expect(sent.teamId).toBe(WAREHOUSE);
    await expect(sent.location).toBe("Jl. Baru 7");
    await expect(sent.receivingHours.find((d) => d.weekday === Weekday.MONDAY)).toMatchObject({
      open: true,
      openTime: "09:00",
      closeTime: "17:00",
    });

    await waitFor(() => expect(canvas.queryByTestId("settings-warehouse-hours-prompt")).toBeNull(), { timeout: 5000 });
    await expect(callsOf(warehouseInfoClient.warehouseInfoDetail)).toBe(2);
    await expect(canvas.getByTestId("settings-warehouse-location")).toHaveValue("Jl. Baru 7");
    await expect(within(canvas.getByTestId("receiving-hours-open-1")).getByRole("checkbox")).toBeChecked();
  },
};

/** The Admin sets the operating hours — a day opened, sent whole with the receiving grid it did not touch. */
export const TheAdminSetsTheOperatingHours: Story = {
  name: "The admin sets the operating hours — sent with the stored receiving grid",
  beforeEach: () => {
    asRole(Role.WAREHOUSE_ADMIN)();
    withHours();
  },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("settings-warehouse-location")).toHaveValue("Jl. Gudang 1, Bekasi"));

    await userEvent.click(within(canvas.getByTestId("operating-hours-open-7")).getByRole("checkbox"));
    await waitFor(() => expect(canvas.getByTestId("operating-hours-from-7")).toBeVisible());
    await userEvent.click(canvas.getByTestId("settings-warehouse-hours-save"));

    await waitFor(() => expect(callsOf(warehouseInfoClient.warehouseInfoUpdate)).toBe(1));
    const sent = lastCall<{ operatingHours: DayInit[]; receivingHours: DayInit[]; location: string }>(
      warehouseInfoClient.warehouseInfoUpdate,
    );
    await expect(sent.operatingHours.find((d) => d.weekday === Weekday.SUNDAY)?.open).toBe(true);
    await expect(sent.receivingHours.filter((d) => d.open)).toHaveLength(6);
    await expect(sent.location).toBe("Jl. Gudang 1, Bekasi");
  },
};

/** A holiday recorded from Settings — through the very ClosuresEditor Edit warehouse shows — is listed. */
export const AClosureAddedIsListed: Story = {
  name: "A closure added is listed",
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    const day = todayIso();

    // The calendar opens on this month, so today's cell is on it (the DatePicker stories' way of picking a day).
    const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
    for (const field of ["closure-first-day", "closure-last-day"]) {
      await userEvent.click(canvas.getByTestId(field));
      const content = await screen.findByTestId(`${field}-content`, {}, { timeout: 5000 });
      await waitFor(() => expect(content).toBeVisible());
      const cell = await waitFor(() => {
        const found = Array.from(
          content.querySelectorAll<HTMLElement>(`[data-part="table-cell-trigger"][data-value="${day}"]`),
        ).find((el) => visible(el) && !el.hasAttribute("data-outside-range"));
        expect(found).toBeDefined();
        return found!;
      });
      await userEvent.click(cell);
      await waitFor(() => expect(content).not.toBeVisible());
    }

    await userEvent.type(canvas.getByTestId("closure-reason"), "Idul Fitri", { delay: 30 });
    await userEvent.click(canvas.getByTestId("closure-add"));

    await waitFor(() => expect(canvas.getByTestId("warehouse-closure-10")).toBeVisible(), { timeout: 5000 });
    await expect(canvas.getByTestId("warehouse-closure-10")).toHaveTextContent("Idul Fitri");
    const sent = lastCall<{ teamId: bigint; firstDay: string; lastDay: string }>(warehouseInfoClient.warehouseClosureAdd);
    await expect(sent).toMatchObject({ teamId: WAREHOUSE, firstDay: day, lastDay: day });
  },
};

/** A listed closure deleted from Settings is gone. */
export const AClosureDeletedIsGone: Story = {
  name: "A closure deleted is gone",
  beforeEach: () => {
    profile = {
      ...noHours(),
      closures: [{ id: 1n, warehouseId: WAREHOUSE, firstDay: "2027-03-30", lastDay: "2027-04-06", reason: "Idul Fitri" }],
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = await hoursLoaded(canvasElement);
    await waitFor(() => expect(canvas.getByTestId("warehouse-closure-1")).toBeVisible(), { timeout: 5000 });

    await userEvent.click(canvas.getByTestId("warehouse-closure-delete-1"));
    await waitFor(() => expect(screen.getByTestId("confirm-action")).toBeVisible(), { timeout: 5000 });
    await userEvent.click(screen.getByTestId("confirm-action"));

    await waitFor(() => expect(canvas.queryByTestId("warehouse-closure-1")).toBeNull(), { timeout: 5000 });
    await expect(callsOf(warehouseInfoClient.warehouseClosureDelete)).toBe(1);
  },
};

/** ONE WarehouseInfoDetail a load — the form, the prompt and the closures list all draw from it. */
export const ReadsTheProfileOnce: Story = {
  name: "Reads the warehouse's profile once — the form, the prompt and the closures from one read",
  play: async ({ canvasElement }) => {
    await hoursLoaded(canvasElement);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(callsOf(warehouseInfoClient.warehouseInfoDetail)).toBe(1);
  },
};

/** Warehouse Staff: no hours editor, no prompt, no closures — and no read of the profile. The fee card is as before. */
export const StaffGetNoHoursEditor: Story = {
  name: "Staff get no hours editor",
  beforeEach: () => {
    asRole(Role.WAREHOUSE_STAFF)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settingsDrawn(canvasElement);

    await expect(canvas.queryByTestId("settings-warehouse-hours")).toBeNull();
    await expect(canvas.queryByTestId("settings-warehouse-hours-prompt")).toBeNull();
    await expect(canvas.queryByTestId("warehouse-closures")).toBeNull();
    await expect(callsOf(warehouseInfoClient.warehouseInfoDetail)).toBe(0);
  },
};

/** A monitor (the admin team reading a warehouse) writes nothing, so it gets no editor either. */
export const AMonitorGetsNoHoursEditor: Story = {
  name: "A monitor gets no hours editor",
  beforeEach: () => {
    asAdminTeam(Role.ADMIN_OWNER, [])();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settingsDrawn(canvasElement);

    await expect(canvas.queryByTestId("settings-warehouse-hours")).toBeNull();
    await expect(canvas.queryByTestId("warehouse-closures")).toBeNull();
  },
};

/** A selling team has no warehouse hours to set — not even for Root, whose role WarehouseInfoUpdate takes. */
export const ASellingTeamHasNoHours: Story = {
  name: "A selling team has no hours card",
  beforeEach: () => {
    asTeam(12n)();
    asRole(Role.ROOT)();
  },
  play: async ({ canvasElement }) => {
    const canvas = await settingsDrawn(canvasElement, false);
    await waitFor(() => expect(canvas.getByTestId("save-default-warehouse")).toBeVisible(), { timeout: 5000 });

    await expect(canvas.queryByTestId("settings-warehouse-hours")).toBeNull();
    await expect(canvas.queryByTestId("warehouse-closures")).toBeNull();
  },
};
