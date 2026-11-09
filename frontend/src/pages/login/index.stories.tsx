import { Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { LocationProbe, marker, routedPage } from "../../../.storybook/pageStory";
import { AuthProvider } from "../../features/auth/AuthContext";
import { ProtectedRoute } from "../../features/auth/AuthGate";
import { LoginPage } from "./index";

// THE LOGIN PAGE — and where signing in GOES. A signed-out visitor is sent here by ProtectedRoute carrying `state.from`,
// the path AND its query, and comes back to it: an AI agent's connect page is nothing without the client_id,
// redirect_uri, state and challenge its OAuth opened it with (our-server-hosts-the-mcp). A `from` that is not a path of
// this app goes home instead.
//
// The stub's Login accepts any username and password as the fixture user; what is pinned here is the way back.

const CONNECT = "/connect-agent";
const QUERY = "?client_id=chatgpt-connector&state=st-1";

/** The page a signed-out visitor asked for, behind the guard — the connect page stands in, with its query on screen. */
const guarded = {
  path: CONNECT,
  element: (
    <ProtectedRoute>
      <Text data-testid="at-connect">at-connect</Text>
      <LocationProbe />
    </ProtectedRoute>
  ),
};

const LoginOnly = routedPage([{ path: "/login", element: <LoginPage /> }, marker("/", "at-home")], "/login");
const RoundTrip = routedPage(
  [guarded, { path: "/login", element: <LoginPage /> }, marker("/", "at-home")],
  { pathname: CONNECT, search: QUERY },
);
const SignedInWithFrom = routedPage([guarded, { path: "/login", element: <LoginPage /> }, marker("/", "at-home")], {
  pathname: "/login",
  state: { from: `${CONNECT}${QUERY}` },
});
const SignedInWithForeignFrom = routedPage(
  [guarded, { path: "/login", element: <LoginPage /> }, marker("/", "at-home")],
  { pathname: "/login", state: { from: "//evil.example/steal" } },
);

const meta = {
  title: "Pages/Login",
  component: LoginOnly,
  parameters: { dataRouter: true },
  // Signed OUT: an AuthProvider with no token settles at once with nobody signed in.
  render: () => (
    <AuthProvider>
      <LoginOnly />
    </AuthProvider>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

async function signIn(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);

  await userEvent.type(await canvas.findByLabelText("Username"), "ani", { delay: 20 });
  await userEvent.type(canvas.getByLabelText("Password"), "hunter22", { delay: 20 });
  await userEvent.click(canvas.getByRole("button", { name: "Sign in" }));

  return canvas;
}

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByRole("heading", { name: "Sign in" })).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { value: "mobile2" } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Sign in" })).toBeVisible();
  },
};

// With nowhere to go back to, signing in goes home.
export const SigningInGoesHome: Story = {
  play: async ({ canvasElement }) => {
    const canvas = await signIn(canvasElement);

    await canvas.findByTestId("at-home");
  },
};

// Sent here from a guarded page, signing in goes BACK to it — its query included.
export const SigningInGoesBackWithTheQuery: Story = {
  render: () => (
    <AuthProvider>
      <RoundTrip />
    </AuthProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = await signIn(canvasElement);

    await canvas.findByTestId("at-connect");
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(QUERY);
  },
};

// Already signed in, /login does not ask again — it goes straight to where the visitor was sent from.
export const AlreadySignedInGoesBack: Story = {
  parameters: { signedIn: true },
  render: () => <SignedInWithFrom />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await canvas.findByTestId("at-connect", {}, { timeout: 4000 });
    await expect(canvas.getByTestId("location-search")).toHaveTextContent(QUERY);
  },
};

// A `from` that names another site is never followed — home instead.
export const AForeignFromGoesHome: Story = {
  parameters: { signedIn: true },
  render: () => <SignedInWithForeignFrom />,
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByTestId("at-home", {}, { timeout: 4000 });
  },
};
