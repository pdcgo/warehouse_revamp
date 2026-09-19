import { Stack, Text } from "@chakra-ui/react";
import { Construction } from "lucide-react";
import { EmptyHint } from "../../../legacy/components/feedback/EmptyHint";
import { ScreenHeader } from "../../components/display/ScreenHeader";

// ── THE PLACEHOLDER ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ TWO ROUTES POINT AT THIS — Notifications and Reports. Both are in the original's router, neither
// is built, and both land here.
//
// It is ported because it is a real and slightly uncomfortable finding about the app: a menu can
// promise a screen that does not exist, and the operator finds out by walking to it. Two of the
// floor app's routes are doors into an empty room.
//
// The right answer is almost always to remove the menu item until the screen exists — an absent item
// costs nothing, and a promised-then-empty one costs trust in every other item. Where a placeholder
// IS warranted (the work is genuinely imminent and people have been told to expect it), it should at
// minimum say WHICH screen is missing and that it is known to be missing, rather than rendering a
// blank page that reads as a bug.
//
// This one takes the screen's name as a prop for exactly that reason: a shared placeholder that
// cannot say what it is standing in for is worse than no placeholder at all.
export const description =
  "The placeholder two routes land on. Ported because it is a real finding: a menu can promise a screen that does not exist. It takes the screen's NAME — a placeholder that cannot say what it stands in for reads as a bug.";

export interface UnfinishedPageProps {
  // Which screen was expected. Required in spirit — see above.
  screen: string;
}

export function UnfinishedPage({ screen }: UnfinishedPageProps) {
  return (
    <Stack gap="section" p="page" data-testid="unfinished-page" data-screen={screen}>
      <ScreenHeader icon={Construction} title={screen} />

      <EmptyHint icon={Construction} title={`${screen} is not built yet`}>
        <Text fontSize="sm" color="fg.muted">
          The menu links here, but the screen does not exist. This is known — it is not something you
          have done wrong, and there is nothing to retry.
        </Text>
      </EmptyHint>
    </Stack>
  );
}
