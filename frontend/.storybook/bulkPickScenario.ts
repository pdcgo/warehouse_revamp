// What the bulk pick list's reads RECEIVED in Storybook (the-bulk-pick-list-prototype-is-accepted), and a refusal a story
// may set. A module of its own with no imports, so a story reads it without pulling the stub into `npm run typecheck`;
// bulkPickStub.ts writes it, the kit's `bulkPickScene` resets it before each story.

export const bulkPickScenario = {
  /** Every OrderPickLines request: the warehouse and the ids, in the order asked. */
  pickLines: [] as { teamId: bigint; orderIds: bigint[] }[],
  /** Every StockPickLocations request that named MANY takes. */
  manyTakes: [] as { warehouseId: bigint; transactionIds: bigint[] }[],
  /** Set → OrderPickLines refuses with this message (a story's failed read). */
  refusal: undefined as string | undefined,
};

export function resetBulkPickScenario() {
  bulkPickScenario.pickLines = [];
  bulkPickScenario.manyTakes = [];
  bulkPickScenario.refusal = undefined;
}
