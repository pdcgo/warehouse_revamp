// A PHOTO TAKEN AT A RESTOCK'S DOOR — the broken units' (a-broken-product-carries-a-photo) or the courier's slip
// (the-courier-slip-has-an-optional-photo) — as the screen holds it while the act is being filled. Pure: the accept
// page's draft (pages/restock-accept/draft.ts) reads it without the picker.

/**
 * The picked FILE, which the screen shows from the device, and — where the act keeps it — the document it was uploaded
 * as. `documentId` is "" while the upload runs, and always where nothing keeps the photo.
 *
 * A photo ALREADY KEPT on the restock — the slip noted at Tandai Tiba, which Terima opens with
 * (the-courier-charge-is-noted-at-tiba-and-final-at-terima) — has no file on this device: `file` is null, `documentId`
 * is the stored one, and `link` its signed link (RestockDoorPhotos; "" until read) to show it from.
 */
export interface DoorPhoto {
  file: File | null;
  documentId: string;
  link?: string;
}

/** A photo the restock already keeps — no file here, shown from its link once read. */
export function keptDoorPhoto(documentId: string, link = ""): DoorPhoto {
  return { file: null, documentId, link };
}

/** The photo's document, when it is kept and its upload has finished — "" otherwise. What an act sends. */
export function keptPhoto(photo: DoorPhoto | null | undefined): string {
  return photo?.documentId ?? "";
}

/** A picked photo whose upload has not finished — the act waits for it (a-save-button-says-what-it-waits-for). */
export function photoUploading(photo: DoorPhoto | null | undefined): boolean {
  return Boolean(photo) && photo!.documentId === "";
}
