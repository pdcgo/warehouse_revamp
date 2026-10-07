import { DesktopLayout } from "./desktop/DesktopLayout";
import { MobileLayout } from "./mobile/MobileLayout";
import { useIsMobile } from "./shell";

// THE APP SHELL, and the only thing it does is CHOOSE one.
//
// A phone is not a narrow desktop. The desktop shell is a persistent 258px sidebar beside a top bar,
// and the whole of it is wrong on a handset: the sidebar eats a third of the screen or hides behind a
// hamburger in the FURTHEST corner from a thumb, and the crew using this app hold the phone one-handed
// at a shelf with a scanner in the other. So the two shells are different STRUCTURES, not one
// structure with breakpoints:
//
//   | desktop            | mobile                                              |
//   | ------------------ | --------------------------------------------------- |
//   | sidebar, always on | bottom tab bar — the team's 3 destinations + More    |
//   | breadcrumb top bar | compact top bar: team chip, screen name, notifications |
//   | menu = the sidebar | menu = a full-screen sheet behind the More tab       |
//
// What they SHARE is everything that thinks: [nav.ts] builds the menu from the team's type and your
// role and answers "where am I", and [shell.ts] owns the breakpoint and the page canvas. A rule that
// lived in one shell would be a rule the other one broke.
//
// ⚠ EXACTLY ONE MOUNTS — see the note on `useIsMobile`. This component has no story of its own for
// that reason: all it holds is a media query, and the story runner has one fixed viewport. Each shell
// is reviewed and tested directly, in desktop/ and mobile/.
export function Layout() {
  const mobile = useIsMobile();

  return mobile ? <MobileLayout /> : <DesktopLayout />;
}
