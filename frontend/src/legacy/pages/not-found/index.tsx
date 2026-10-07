import { Center, Stack } from "@chakra-ui/react";
import { House, SearchX } from "lucide-react";
import { EmptyHint } from "../../components/feedback/EmptyHint";
import { Button } from "../../components/inputs/Button";

// The 404. It offers ONE way out, and that way out is a link.
//
// A dead end that only says "not found" leaves the reader with the back button — which returns them
// to whatever produced the bad link in the first place. Naming a destination, and making it a real
// anchor rather than a navigate() call, is what turns the page from a wall into a door.
export const description =
  "The 404 screen: says what happened and offers one real link back, rather than leaving the reader with only the back button.";

export function NotFoundPage({ homeHref = "/" }: { homeHref?: string }) {
  return (
    <Center flex="1" minH="60" py="12" data-testid="page-not-found">
      <Stack align="center" gap="4">
        <EmptyHint icon={SearchX} title="Page not found">
          The page you were looking for does not exist, or has moved.
        </EmptyHint>

        <Button icon={House} href={homeHref}>
          Back to dashboard
        </Button>
      </Stack>
    </Center>
  );
}
