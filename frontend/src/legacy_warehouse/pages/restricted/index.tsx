import { Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";
import { EmptyHint } from "../../../legacy/components/feedback/EmptyHint";
import { ScreenHeader } from "../../components/display/ScreenHeader";

// ── RESTRICTED ──────────────────────────────────────────────────────────────────────────────────
//
// What a role-gated route renders for somebody who is not allowed in.
//
// ⚠ IT SHOULD ALMOST NEVER BE SEEN, AND THAT IS THE POINT OF SHIPPING IT.
//
// The menu already removes items the caller cannot use (see nav.ts — absent, not greyed out), so
// nobody reaches this by clicking. Getting here means one of three things, and all three are worth
// knowing about:
//
//   · a shared link — the most common, and a completely reasonable thing to have done
//   · a bookmark from a shift when you had the role, or from the previous person's session
//   · a role that was removed while you were logged in
//
// The last one is why it exists at all: the menu is built at render time from your roles, but a role
// can be revoked mid-session, and the route guard is the thing that actually holds. A screen that
// simply rendered nothing would look like a bug at exactly the moment the system was working
// correctly.
//
// ⚠ IT NAMES WHAT IS NEEDED, NOT WHAT YOU ARE. "You need the owner or admin role" is actionable —
// the operator knows who to ask. "Access denied" makes them ask someone what it means first, and
// listing the roles they DO have would be a slightly hostile way to say no.
export const description =
  "What a role-gated route renders for someone not allowed in. Should almost never be seen — the menu hides what you cannot use — so reaching it means a shared link, a stale bookmark, or a role revoked mid-session.";

export interface RestrictedPageProps {
  // Which screen was being asked for. Without it the message is "no" with no subject.
  screen?: string;
  // What would be needed. Named so the operator knows who to ask.
  requires?: string[];
}

export function RestrictedPage({ screen = "This screen", requires = [] }: RestrictedPageProps) {
  return (
    <Stack gap="section" p="page" data-testid="restricted-page">
      <ScreenHeader icon={Lock} title="Not allowed" />

      <EmptyHint icon={Lock} title={`${screen} is not open to you`}>
        <Stack gap="2">
          {requires.length > 0 && (
            <Text fontSize="sm" color="fg.muted" data-testid="required-roles">
              It needs the {requires.map((r) => `"${r}"`).join(" or ")} role. Ask a supervisor if you
              should have it.
            </Text>
          )}
          {/* The revoked-mid-session case, said out loud. Otherwise the operator's model is "the app
              is broken", when the app is in fact working. */}
          <Text fontSize="sm" color="fg.muted">
            If this worked earlier today, your role may have changed — sign out and back in to see
            the current menu.
          </Text>
        </Stack>
      </EmptyHint>
    </Stack>
  );
}
