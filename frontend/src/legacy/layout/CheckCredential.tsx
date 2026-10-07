import type { ReactNode } from "react";
import { Center, Stack, Text } from "@chakra-ui/react";
import { Spinner } from "../components/feedback/Spinner";

// CheckCredential holds the whole shell back while the session is still being established.
//
// It exists because of what the alternative looks like. Rendering the app immediately means the
// sidebar draws with no user and no role, so every role-gated link is absent; a beat later the
// session lands and the menu visibly grows. To the reader that reads as the app deciding, in front
// of them, what they are allowed to do — and on a slow connection it is long enough to start
// clicking into a menu that is about to change under the cursor.
//
// ⚠ THIS IS NOT AN AUTH BOUNDARY. It is a loading gate. Whether the viewer may see anything is
// decided by the server on every request; this only avoids rendering a half-known session.
export const description =
  "Holds the shell back while the session loads, so the nav does not visibly grow as roles arrive. A loading gate, NOT an auth boundary — the server decides access.";

export interface CheckCredentialProps {
  // True while the session is still being resolved.
  checking?: boolean;
  label?: string;
  children: ReactNode;
}

export function CheckCredential({ checking, label = "Checking credentials", children }: CheckCredentialProps) {
  if (!checking) return <>{children}</>;

  return (
    <Center flex="1" minH="60" data-testid="check-credential">
      <Stack align="center" gap="3">
        <Spinner />
        <Text color="fg.muted" fontSize="sm">
          {label}
        </Text>
      </Stack>
    </Center>
  );
}
