import { addons } from "storybook/manager-api";

// THE CANVAS GETS THE WINDOW (owner).
//
// Storybook's chrome eats the story: at a 1440×900 window the sidebar takes 275px and the addons panel
// another ~300px of HEIGHT, leaving the canvas 1140×560 — so a page story is reviewed in a letterbox
// and a long form is judged on the third of it that fits.
//
// The panel is what goes: it is the Interactions/Controls drawer, useful while writing a story and in
// the way while looking at one. The sidebar stays, because navigating between stories is the other
// half of the workbench.
//
// Both are one keystroke away, and neither needs this file changed:
//   A  panel on/off        D  panel bottom/right
//   S  sidebar on/off      F  full screen (hides both)
addons.setConfig({
  showPanel: false,
});
