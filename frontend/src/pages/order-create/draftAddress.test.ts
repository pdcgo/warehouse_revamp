import { describe, expect, it } from "vitest";

import { OrderAddressSchema } from "../../gen/warehouse/selling/v1/order_pb";
import { create } from "@bufbuild/protobuf";

import { addressOf } from "./draftAddress";

// THE DRAFT ADDRESS SEED (the-cs-edits-the-whole-address-before-create): the form opens with the region list's one
// matching place when the server found one (`regionMatch`), and with EMPTY dropdowns otherwise — never with the draft's
// own names standing in a code-driven picker that could not open the level below them. The postcode and the street
// line are the draft's either way.
const scraped = create(OrderAddressSchema, {
  provinsiName: "JAWA BARAT",
  kabupatenName: "Kab. Bogor",
  kecamatanName: "Cibinong",
  desaName: "Pakansari",
  kodePos: "16915",
  addressLine: "Jl. Raya 1",
});

const place = create(OrderAddressSchema, {
  provinsiCode: "32",
  provinsiName: "Jawa Barat",
  kabupatenCode: "32.01",
  kabupatenName: "Kabupaten Bogor",
  kecamatanCode: "32.01.01",
  kecamatanName: "Cibinong",
  desaCode: "32.01.01.1001",
  desaName: "Pakansari",
  kodePos: "16916",
});

describe("addressOf", () => {
  it("pre-fills the four levels from the one matching place, keeping the draft's postcode and street", () => {
    const got = addressOf({ address: scraped, regionMatch: place });

    expect(got.kabupatenCode).toBe("32.01");
    expect(got.kabupatenName).toBe("Kabupaten Bogor");
    expect(got.desaCode).toBe("32.01.01.1001");
    expect(got.kodePos).toBe("16915");
    expect(got.addressLine).toBe("Jl. Raya 1");
  });

  it("takes the place's postcode only when the draft read none", () => {
    const got = addressOf({ address: create(OrderAddressSchema, { addressLine: "Jl. 2" }), regionMatch: place });

    expect(got.kodePos).toBe("16916");
  });

  it("opens the dropdowns empty without a match — the draft's names stay its text, not the picker's", () => {
    const got = addressOf({ address: scraped, regionMatch: undefined });

    expect([got.provinsiCode, got.provinsiName, got.kabupatenName, got.kecamatanName, got.desaName]).toEqual([
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(got.kodePos).toBe("16915");
    expect(got.addressLine).toBe("Jl. Raya 1");
  });

  it("opens empty for a draft with no address at all", () => {
    const got = addressOf({ address: undefined, regionMatch: undefined });

    expect(Object.values(got).every((v) => v === "")).toBe(true);
  });
});
