// WHICH RESTOCK WRITE A SAVE CALLED, in Storybook — recorded by restockStub.ts and reset with it:
//   writes  each RestockRequestUpdate (the edit form, the whole restock) and RestockRequestNoteSet (the selling team's
//           note alone) the stub took, in order, with the restock and the note it carried. The selling note's Ubah saves
//           through the note set in every status, on its way too (the-note-is-edited-in-any-status, #71) — a story pins
//           that its save is a note set and never the whole restock sent back.
//
// ⚠ ITS OWN MODULE (as sessionScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole stub
// into `npm run typecheck`.

export type RestockWrite = {
  rpc: "RestockRequestUpdate" | "RestockRequestNoteSet";
  teamId: bigint;
  requestId: bigint;
  note: string;
};

export const restockWriteScenario: { writes: RestockWrite[] } = { writes: [] };

export function resetRestockWriteScenario() {
  restockWriteScenario.writes = [];
}
