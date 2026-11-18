// UPLOADS, as a story wants them to go — held until the story lets them through, or refused — read by stubTransport.ts's
// DocumentService and its PUT (stubUploads, which resets this per story). Every upload is quick and kept otherwise.
//
// ⚠ ITS OWN MODULE (as restockAcceptScenario.ts): a story imports it, and importing stubTransport.ts would pull the whole
// stub into `npm run typecheck`.

export const uploadScenario: {
  /** While set, every PUT waits for it — an upload still on its way. */
  gate: Promise<void> | null;
  /** RequestUpload answers this refusal (the server's words) instead of a place to put the bytes. */
  refusal: string;
} = { gate: null, refusal: "" };

/** Holds every upload from now until the returned function is called. */
export function holdUploads(): () => void {
  let release = () => {};
  uploadScenario.gate = new Promise<void>((resolve) => {
    release = () => {
      uploadScenario.gate = null;
      resolve();
    };
  });

  return release;
}

/** Refuses every upload from now on, with the server's words. */
export function refuseUploads(refusal = "storage is not answering") {
  uploadScenario.refusal = refusal;
}

export function resetUploadScenario() {
  uploadScenario.gate = null;
  uploadScenario.refusal = "";
}
