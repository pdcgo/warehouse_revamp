// Types only: this module stays free of the picker's runtime (Chakra, the region client), so its unit test runs in Node.
import type { AddressValue } from "../../components/customers/AddressPicker";
import type { OrderDraft } from "../../gen/warehouse/selling/v1/order_draft_pb";

// A draft's address as the form OPENS with it (the-cs-edits-the-whole-address-before-create). A draft keeps names only
// (an-address-is-plain-names) and the picker works by code, so the four region levels come from the draft's
// `regionMatch` — the one region-list place its names match (*Pre-filled when certain*) — and open EMPTY when there is
// none, for the person to pick while reading the draft's own text (DraftAddressText). The postcode and the street line
// are the draft's, as read. Every part stays editable: this is only where the form starts.
export function addressOf(draft: Pick<OrderDraft, "address" | "regionMatch">): AddressValue {
  const a = draft.address;
  const m = draft.regionMatch;
  const kodePos = a?.kodePos ?? "";
  const addressLine = a?.addressLine ?? "";

  if (!m) {
    return {
      provinsiCode: "",
      provinsiName: "",
      kabupatenCode: "",
      kabupatenName: "",
      kecamatanCode: "",
      kecamatanName: "",
      desaCode: "",
      desaName: "",
      kodePos,
      addressLine,
    };
  }

  return {
    provinsiCode: m.provinsiCode,
    provinsiName: m.provinsiName,
    kabupatenCode: m.kabupatenCode,
    kabupatenName: m.kabupatenName,
    kecamatanCode: m.kecamatanCode,
    kecamatanName: m.kecamatanName,
    desaCode: m.desaCode,
    desaName: m.desaName,
    // The draft's postcode wins — the app read it off the label; the place's own fills a blank one.
    kodePos: kodePos || m.kodePos,
    addressLine,
  };
}
