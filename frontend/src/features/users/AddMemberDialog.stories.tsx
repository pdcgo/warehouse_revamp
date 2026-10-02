import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";

import { asTeam } from "../../../.storybook/pageStory";
import { asRole } from "../../../.storybook/sessionScenario";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { AddMemberDialog } from "./AddMemberDialog";

// The Add Member search popup — docs/business/user/context_decision.md#a-member-is-found-in-a-search-popup.
// A PROTOTYPE: the stub (.storybook/userStub.ts) answers the way the decisions say; the running server
// still matches any two letters for everyone and says nothing about who is already in the team.
//
// Gudang Pusat (team 11): Dewi (Owner, phone 0812-3456-7890), Budi (Admin), Eko (Staff), Citra (Staff,
// suspended). Ani Lestari (`anil`, phone ending 8888) is in no team. Every play() is one decided rule.

const meta = {
  title: "Features/Users/AddMemberDialog",
  component: AddMemberDialog,
  parameters: { signedIn: true },
  beforeEach: () => {
    asTeam(11n)();
    asRole(Role.WAREHOUSE_OWNER)();
  },
} satisfies Meta<typeof AddMemberDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

async function search(canvasElement: HTMLElement, q: string) {
  await userEvent.click(await within(canvasElement).findByTestId("open-add-member", {}, { timeout: 4000 }));
  const dialog = await screen.findByTestId("add-member-dialog");
  await userEvent.type(within(dialog).getByTestId("add-member-search"), q, { delay: 20 });

  return dialog;
}

async function pick(dialog: HTMLElement, username: string) {
  const row = await within(dialog).findByTestId(`add-member-result-${username}`, {}, { timeout: 4000 });
  await userEvent.click(row);
  await within(dialog).findByTestId("add-member-picked");
}

// ── The states worth looking at ─────────────────────────────────────────────────────────────────

export const AsTheOwner: Story = {};

export const AsRoot: Story = { beforeEach: asRole(Role.ROOT) };

// ── The rules worth failing on ──────────────────────────────────────────────────────────────────

// managers-search-by-exact-username-phone-or-email — an Owner never browses: part of a name finds
// nobody, the whole username finds the one person.
export const AnOwnerFindsOnlyAnExactMatch: Story = {
  play: async ({ canvasElement }) => {
    // Part of a surname — both Anis carry it, and neither is found.
    const dialog = await search(canvasElement, "lestari");
    await expect(await within(dialog).findByTestId("add-member-no-match", {}, { timeout: 4000 })).toBeInTheDocument();

    const input = within(dialog).getByTestId("add-member-search");
    await userEvent.clear(input);
    await userEvent.type(input, "anil", { delay: 20 });

    // a-result-shows-the-phones-last-four-digits
    const row = await within(dialog).findByTestId("add-member-result-anil", {}, { timeout: 4000 });
    await expect(row).toHaveTextContent("phone ending 8888");
  },
};

// A phone matches however it is written — 0812… and +62 812… are one number.
export const APhoneMatchesHoweverItIsWritten: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "+62 812-3456-7890");

    await expect(await within(dialog).findByTestId("add-member-result-dewi", {}, { timeout: 4000 })).toBeInTheDocument();
  },
};

// Root and the Administrator search by part — and two Anis are told apart by the phone ending.
export const RootSearchesByPart: Story = {
  beforeEach: asRole(Role.ROOT),
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "ani");

    await expect(await within(dialog).findByTestId("add-member-result-anil", {}, { timeout: 4000 })).toHaveTextContent("8888");
    await expect(within(dialog).getByTestId("add-member-result-ani")).toBeInTheDocument();
  },
};

// a-suspended-user-is-never-picked
export const ASuspendedAccountIsNeverOffered: Story = {
  beforeEach: asRole(Role.ROOT),
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "citra");

    await expect(await within(dialog).findByTestId("add-member-no-match", {}, { timeout: 4000 })).toBeInTheDocument();
  },
};

// Someone not in the team gets Select Role, and the button says Add.
export const ANewcomerGetsSelectRole: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "anil");
    await pick(dialog, "anil");

    await expect(within(dialog).queryByTestId("add-member-current-role")).toBeNull();
    await expect(within(dialog).getByTestId("submit-add-member")).toHaveTextContent("Add");

    await userEvent.click(within(dialog).getByTestId("submit-add-member"));
    await expect(await screen.findByText("Member added")).toBeInTheDocument();
  },
};

// an-existing-member-gets-change-role — the result already says they are here, and the step says so.
export const AMemberGetsChangeRole: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "eko");

    await expect(await within(dialog).findByTestId("add-member-result-eko", {}, { timeout: 4000 })).toHaveTextContent(
      "Warehouse Staff",
    );
    await pick(dialog, "eko");

    await expect(within(dialog).getByTestId("add-member-current-role")).toHaveTextContent("Warehouse Staff");
    await expect(within(dialog).getByTestId("submit-add-member")).toHaveTextContent("Change Role");
  },
};

// change-role-only-below-your-own — an Admin finds a fellow Admin, and may not change them.
export const AnAdminCannotChangeAnAdmin: Story = {
  beforeEach: asRole(Role.WAREHOUSE_ADMIN),
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "budi");
    await pick(dialog, "budi");

    await expect(within(dialog).getByTestId("add-member-cannot-change")).toBeInTheDocument();
    await expect(within(dialog).getByTestId("submit-add-member")).toBeDisabled();
  },
};

// Nobody found → Create User → Create and Add, one step (context.md §How Managing Team User Member).
export const NobodyFoundCreatesThem: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "hendra");
    await userEvent.click(await within(dialog).findByTestId("add-member-create", {}, { timeout: 4000 }));

    // What was typed is most often the username they were meant to have.
    await expect(within(dialog).getByTestId("add-member-new-username")).toHaveValue("hendra");
    await userEvent.type(within(dialog).getByTestId("add-member-new-password"), "hendra123", { delay: 20 });
    await expect(within(dialog).getByTestId("submit-add-member")).toHaveTextContent("Create and Add");

    await userEvent.click(within(dialog).getByTestId("submit-add-member"));
    await expect(await screen.findByText("hendra created")).toBeInTheDocument();
  },
};

// a-phone-or-email-belongs-to-one-account — a phone already on Dewi's account is refused.
export const APhoneAlreadyTakenIsRefused: Story = {
  play: async ({ canvasElement }) => {
    const dialog = await search(canvasElement, "hendra");
    await userEvent.click(await within(dialog).findByTestId("add-member-create", {}, { timeout: 4000 }));

    await userEvent.type(within(dialog).getByTestId("add-member-new-password"), "hendra123", { delay: 20 });
    await userEvent.type(within(dialog).getByTestId("add-member-new-phone"), "0812 3456 7890", { delay: 20 });
    await userEvent.click(within(dialog).getByTestId("submit-add-member"));

    await waitFor(() => expect(within(dialog).getByTestId("add-member-error")).toHaveTextContent("already someone's account"));
  },
};
