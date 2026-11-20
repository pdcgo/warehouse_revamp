// What a story can make the stub settlement importer say — set in a story's `beforeEach`, cleared by
// `resetSettlementImports` in preview.tsx.
//
// ⚠ ITS OWN MODULE, deliberately. A story imports these switches; importing them from stubTransport.ts
// would pull the whole stub into `npm run typecheck`, which checks `src` and everything it imports.
export const settlementImportScenario = {
  // Shops whose ShopAccessCheck answers no primary CS (a-shop-with-no-primary-cs-cannot-import).
  noPrimaryCs: new Set<bigint>(),
  // The next file's orders belong to another shop (a-file-with-another-shops-orders-is-refused).
  wrongShopFile: false,
  // How long each row takes: slow enough to watch in the preview, fast enough for the test run.
  stepMs: 40,
  // How long the file's page waits for its reads — the file (UploadedFileByIds) and its rows (UploadedFileLineList) —
  // so a story can watch a first load (backlog #94: the skeletons, and a tab waiting for its own rows). 0 = at once.
  fileHoldMs: 0,
  linesHoldMs: 0,
};

export function resetSettlementImportScenario() {
  settlementImportScenario.noPrimaryCs.clear();
  settlementImportScenario.wrongShopFile = false;
  settlementImportScenario.stepMs = 40;
  settlementImportScenario.fileHoldMs = 0;
  settlementImportScenario.linesHoldMs = 0;
}
