// The e2e API publishes events to the local Pub/Sub EMULATOR (backend/cmd/app_development/event_sender.go) —
// placing an order publishes "order placed", for instance.
//
// ⚠ WITHOUT THE EMULATOR A PUBLISH IS NOT REFUSED, IT WAITS — about 60 s, for an answer that never comes. So the
// suite does not fail where the cause is: the first test that places an order times out ten seconds later on the
// order form, with a Create button stuck in its loading state that reads as an invalid form. That cost a whole
// investigation once (2026-10-06). Checking up front turns it into one line that names the fix.

/** Where the emulator is — the same default the server uses (event_source.NewPubsubEmulator). */
export const PUBSUB_HOST = process.env.PUBSUB_EMULATOR_HOST || "localhost:8085";

/** The project the dev server publishes to (event_sender.go `devProjectID`). */
export const PUBSUB_PROJECT = "warehouse-dev";

/** Throws, with the command that fixes it, when the emulator does not answer. */
export async function requirePubsubEmulator(): Promise<void> {
  let reachable = false;

  try {
    // The emulator answers a plain GET on its root with "Ok".
    const res = await fetch(`http://${PUBSUB_HOST}/`, { signal: AbortSignal.timeout(3000) });
    reachable = res.ok;
  } catch {
    reachable = false;
  }

  if (reachable) {
    return;
  }

  throw new Error(
    [
      `The Pub/Sub emulator is not answering on ${PUBSUB_HOST}.`,
      "",
      "The e2e API publishes events to it, and without it a publish does not fail — it waits about 60 s — so",
      "every test that places an order would time out on a screen with nothing wrong with it. Start it, then",
      "run the e2e again:",
      "",
      "  docker compose --profile pubsub up -d pubsub",
      "",
      "(The topics are created by the e2e setup itself, with `san pubsub ensure`.)",
    ].join("\n"),
  );
}

/**
 * The topics exist only once `san pubsub ensure` has run, and the emulator keeps them IN MEMORY: restart it and
 * they are gone, and a publish to a missing topic fails the same slow way. Ensuring them every run is idempotent
 * and takes a second, so a restarted emulator can never cost an investigation again.
 */
export function ensurePubsubTopicsCommand(): string {
  return `go run ../tools/san pubsub ensure --project ${PUBSUB_PROJECT} --emulator`;
}
