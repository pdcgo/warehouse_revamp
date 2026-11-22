import { describe, expect, it } from "vitest";

import { trackingHref, trackingLinkProblem } from "./trackingLink";

// THE COURIER'S TRACKING LINK (an-orders-resi-links-to-the-couriers-tracking-page): the href an order's resi opens, and
// the rule the channels screen checks root's link by — the server's own (shipment_v1 tracking_url.go). The stories pin
// the same on the screens.

describe("trackingHref", () => {
  it("puts the resi where {resi} is", () => {
    expect(trackingHref("https://courier.example/track?awb={resi}", "JP0001234567")).toBe(
      "https://courier.example/track?awb=JP0001234567",
    );
  });

  it("URL-encodes the resi, so a space, / # & never change where the link goes", () => {
    expect(trackingHref("https://courier.example/track?awb={resi}&lang=id", " JP 12/34#5&x ")).toBe(
      "https://courier.example/track?awb=JP%2012%2F34%235%26x&lang=id",
    );
  });

  it("fills every {resi}", () => {
    expect(trackingHref("https://courier.example/{resi}?awb={resi}", "AB1")).toBe("https://courier.example/AB1?awb=AB1");
  });

  it("opens nothing without a link, without {resi} in it, or without a resi", () => {
    expect(trackingHref("", "JP1")).toBeNull();
    expect(trackingHref(undefined, "JP1")).toBeNull();
    expect(trackingHref("https://courier.example/track", "JP1")).toBeNull();
    expect(trackingHref("https://courier.example/track?awb={resi}", "")).toBeNull();
    expect(trackingHref("https://courier.example/track?awb={resi}", "   ")).toBeNull();
  });
});

describe("trackingLinkProblem", () => {
  it("takes an https link holding {resi}, and no link at all", () => {
    expect(trackingLinkProblem("https://courier.example/track?awb={resi}")).toBeNull();
    expect(trackingLinkProblem("  https://courier.example/{resi}  ")).toBeNull();
    expect(trackingLinkProblem("")).toBeNull();
    expect(trackingLinkProblem("   ")).toBeNull();
  });

  it("refuses anything but https", () => {
    expect(trackingLinkProblem("http://courier.example/track?awb={resi}")).toBe("notHttps");
    expect(trackingLinkProblem("courier.example/track?awb={resi}")).toBe("notHttps");
    expect(trackingLinkProblem("javascript:alert({resi})")).toBe("notHttps");
  });

  it("refuses a link with no {resi}", () => {
    expect(trackingLinkProblem("https://courier.example/track")).toBe("noResi");
    expect(trackingLinkProblem("https://courier.example/track?awb={RESI}")).toBe("noResi");
  });

  it("refuses text that is no address", () => {
    expect(trackingLinkProblem("https://{resi}")).toBeNull();
    expect(trackingLinkProblem("https:// courier.example/{resi}")).toBe("notAUrl");
    expect(trackingLinkProblem("https://")).toBe("noResi");
  });
});
