// WHAT THE SELLING RESTOCK LIST'S EXPORT WAS ASKED, in Storybook (the-restock-list-exports-and-filters-by-courier) —
// recorded by restockStub.ts's RestockRequestExport and reset with the stub:
//   calls  each export's team, the filter it was sent (the list's own) and how many restocks the file holds
//   hold   while set, the stream waits after its first message (the count) — a story reads the progress on the button,
//          then calls `release()` and the file arrives
//
// ⚠ ITS OWN MODULE (as restockReadScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole
// stub into `npm run typecheck`.

export interface RestockExportCall {
  teamId: bigint;
  filter:
    | {
        status?: number;
        warehouseId?: bigint;
        createdByUserId?: bigint;
        acceptedByUserId?: bigint;
        shipmentId?: bigint;
        dateField?: number;
        fromUnix?: bigint;
        toUnix?: bigint;
        q?: string;
      }
    | undefined;
  /** The restocks the file holds. */
  rows: number;
}

export const restockExportScenario: {
  calls: RestockExportCall[];
  hold: Promise<void> | null;
} = { calls: [], hold: null };

/** Holds every export after its first message until the returned `release` is called. */
export function holdRestockExport(): () => void {
  let release = () => {};
  restockExportScenario.hold = new Promise<void>((resolve) => {
    release = resolve;
  });

  return () => {
    restockExportScenario.hold = null;
    release();
  };
}

export function resetRestockExportScenario() {
  restockExportScenario.calls = [];
  restockExportScenario.hold = null;
}
