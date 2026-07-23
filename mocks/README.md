# mocks/ — mock-first UI previews

Design a screen **before** it is built. Each file here is a **standalone, self-contained HTML
mockup** of one screen: hardcoded sample data, inline CSS, no build step and no running app. Open
it straight in a browser — that is the whole point, a preview anyone can look at and react to before
a line of real React is written (#201).

## The rules

- **One file per screen**, named for the screen: `accept-rack.html`, not `accept/rack.html`. Flat,
  like `frontend/src/pages/`.
- **Self-contained.** Everything inline — no external CSS, fonts, scripts, or images. A mockup that
  needs a server is not a mockup you can just open.
- **Fake data, real jobs.** The data is invented, but the screen shows the actual task a real person
  is trying to finish. A mock that skips the hard case (a short count, a broken item, an unplaced
  line) is a mock that designs the easy screen.
- **Not the design system.** These use plain HTML/CSS on purpose — they are throwaway previews to
  argue about layout, not the app. When a mock is agreed, the real screen is built from Chakra and
  the shared components (see `CLAUDE.md` — "The design system"), and the mock has done its job.

## What is here

| File | Screen | Notes |
| --- | --- | --- |
| [accept-rack.html](accept-rack.html) | Accept a delivery onto racks | A redesign of the wired `restock-accept` screen (#157), leaning into rack put-away — counting a delivery and naming which shelf each line goes on, in one step. |
