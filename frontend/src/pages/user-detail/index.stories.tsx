import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, waitFor, within } from "storybook/test";

import { routedPage } from "../../../.storybook/pageStory";
import { userClient } from "../../api/clients";
import { queryClient as appQueryClient } from "../../api/queryClient";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { UserTeamsResponseSchema } from "../../gen/warehouse/user/v1/user_pb";
import { UserDetailPage } from "./index";

// ONE PERSON'S PAGE (#40) — the user and the teams they joined, one UserTeams: a root/admin read. The stub has no
// UserTeams, so each story answers it with a spy.
//
// HOW OFTEN IT IS ASKED (#133, the-speed-audits-old-findings-are-fixed-smallest-first): a seat the server refuses is told
// once — the app's shared `retry: 1` sent the same refused body again a second later, the speed audit's one read twice —
// and a read that got no answer is still asked once more. Storybook's client never retries (preview.tsx), so those
// stories mount the page under a client with the APP's own defaults.

const Routed = routedPage([{ path: "/users/:userId", element: <UserDetailPage /> }], "/users/65");

/** The page under a fresh client carrying the app's own query defaults (api/queryClient.ts) — `retry: 1` included. */
function UnderTheAppsDefaults() {
  const client = useMemo(() => new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() }), []);

  return (
    <QueryClientProvider client={client}>
      <Routed />
    </QueryClientProvider>
  );
}

const meta = {
  title: "Pages/Users/UserDetail",
  component: Routed,
  // No "padded" layout: a page story is framed by its shell's gutter (a-page-story-has-its-shells-gutter).
  parameters: { signedIn: true, dataRouter: true },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Eko, in Toko Melati as its Customer Service and in Gudang Pusat as its staff. */
function answersEko() {
  const spy = spyOn(userClient, "userTeams").mockImplementation(async () =>
    create(UserTeamsResponseSchema, {
      user: { id: 65n, username: "eko", name: "Eko Prasetyo" },
      items: [
        {
          d: {
            case: "teamAccess",
            value: {
              mapData: {
                "12": { teamId: 12n, role: Role.SELLING_CS, teamName: "Toko Melati", teamType: TeamType.SELLING },
                "11": { teamId: 11n, role: Role.WAREHOUSE_STAFF, teamName: "Gudang Pusat", teamType: TeamType.WAREHOUSE },
              },
            },
          },
        },
      ],
      ids: [12n, 11n],
      pageInfo: { totalItems: 2n },
    }),
  );

  return () => spy.mockRestore();
}

/** UserTeams answers every ask with `code`. */
function refusesWith(code: Code) {
  return () => {
    const spy = spyOn(userClient, "userTeams").mockImplementation(async () => {
      throw new ConnectError("story: UserTeams answers with an error", code);
    });

    return () => spy.mockRestore();
  };
}

const asked = () => (userClient.userTeams as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

/** The person, and the teams they joined. */
export const Default: Story = {
  beforeEach: answersEko,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("user-detail-page")).toHaveTextContent("Eko Prasetyo"), { timeout: 5000 });
    await expect(canvas.getByTestId("user-detail-page")).toHaveTextContent("Toko Melati");
    await expect(canvas.getByTestId("user-detail-page")).toHaveTextContent("Gudang Pusat");
    await expect(canvas.queryByTestId("user-detail-error")).toBeNull();
  },
};

// A PHONE (every-page-has-a-mobile-story).
export const Mobile: Story = {
  name: "Mobile",
  globals: { viewport: { value: "mobile1" } },
  beforeEach: answersEko,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("user-detail-page")).toHaveTextContent("Gudang Pusat"), { timeout: 5000 });
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};

/** A seat UserTeams refuses (403) reads the refusal at once, and it is asked ONCE. */
export const ARefusalIsAskedOnce: Story = {
  name: "Refused — asked once",
  beforeEach: refusesWith(Code.PermissionDenied),
  render: () => <UnderTheAppsDefaults />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("user-detail-error")).toBeVisible(), { timeout: 5000 });
    await expect(asked()).toBe(1);
    // …and stays asked once: the app's retry would have sent it again a second later.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(asked()).toBe(1);
  },
};

/** A read that got no answer (the server unreachable) is still asked once more before the page says so. */
export const NoAnswerIsAskedOnceMore: Story = {
  name: "No answer — asked once more",
  beforeEach: refusesWith(Code.Unavailable),
  render: () => <UnderTheAppsDefaults />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await waitFor(() => expect(canvas.getByTestId("user-detail-error")).toBeVisible(), { timeout: 5000 });
    await expect(asked()).toBe(2);
  },
};
