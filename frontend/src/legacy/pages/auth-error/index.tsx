import { Center, HStack, Stack } from "@chakra-ui/react";
import { LogOut, RefreshCw, ShieldAlert } from "lucide-react";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { Button } from "../../components/inputs/Button";

// The session-broken screen. It offers TWO actions, in escalating order, and the order is the point.
//
// Most auth failures here are transient — a token that expired while a tab sat open, a clock skew, a
// dropped refresh. Reloading fixes those and costs nothing. Signing out fixes the rest but throws
// away whatever the person had open, so it is the second offer, not the first.
//
// Putting sign-out first (or making it the only option) turns every recoverable hiccup into a full
// re-login, which on a warehouse floor means finding the password again mid-shift.
export const description =
  "The session-broken screen. Offers reload FIRST and sign-out second: most auth failures here are transient, and sign-out throws away whatever was open.";

export function AuthErrorPage({ onLogout }: { onLogout?(): void }) {
  return (
    <Center flex="1" minH="60" py="12" data-testid="page-auth-error">
      <Stack align="center" gap="4">
        <EmptyHint icon={ShieldAlert} title="Your session has a problem">
          Try reloading the page. If that does not help, sign in again.
        </EmptyHint>

        <HStack gap="2">
          <Button icon={RefreshCw} onClick={() => location.reload()} data-testid="auth-error-reload">
            Reload
          </Button>
          <Button
            tone="plain"
            variant="outline"
            icon={LogOut}
            onClick={onLogout}
            data-testid="auth-error-logout"
          >
            Sign out
          </Button>
        </HStack>
      </Stack>
    </Center>
  );
}
