import { Center, Stack } from "@chakra-ui/react";
import { ArrowLeft, Lock } from "lucide-react";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { Button } from "../../components/inputs/Button";

// The "you may not see this" screen.
//
// It says WHOSE decision it was and what to do about it, because the reader's next move depends
// entirely on that: a permission they should have is a message to send someone, and one they should
// not have is a wrong turn. "Access denied" alone answers neither, so people retry, then ask whether
// the app is broken.
//
// ⚠ Reaching this screen is NOT what enforces anything. The access interceptor refused the RPC; this
// is how that refusal is reported. Never treat "the UI hid it" as a control.
export const description =
  "The permission-refused screen: names whose decision it was and what to do next, because 'access denied' alone leaves the reader unsure whether the app is broken.";

export function NoPermissionPage({
  what = "this page",
  backHref = "/",
}: {
  // What was refused — "the billing screens", "this warehouse". A specific noun turns the message
  // from a category error into something a colleague can act on.
  what?: string;
  backHref?: string;
}) {
  return (
    <Center flex="1" minH="60" py="12" data-testid="page-no-permission">
      <Stack align="center" gap="4">
        <EmptyHint icon={Lock} title="You do not have access">
          Your role does not include {what}. Ask a team owner or an admin if you need it.
        </EmptyHint>

        <Button tone="plain" variant="outline" icon={ArrowLeft} href={backHref}>
          Go back
        </Button>
      </Stack>
    </Center>
  );
}
