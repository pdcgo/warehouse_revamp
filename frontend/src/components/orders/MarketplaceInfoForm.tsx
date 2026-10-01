import { useTranslation } from "react-i18next";
import { Field, Input, SimpleGrid, Stack } from "@chakra-ui/react";
import { ShopSelect } from "../pickers/ShopSelect";
import { MarketplaceSelect } from "../pickers/MarketplaceSelect";
import { CurrencyInput } from "../inputs/CurrencyInput";
import { Marketplace } from "../../gen/warehouse/marketplace/v1/marketplace_pb";

// WHAT THE STOREFRONT SAYS ABOUT THIS ORDER — which shop, its id there, and what it took.
//
// The three belong together and none is much use alone: a shop with no reference is an order nobody
// can find again on the marketplace, a reference with no shop has nowhere to be looked up, and a
// total with neither is a number with no source. Keeping them in one component is what stops a
// screen collecting one and forgetting the others.
export interface MarketplaceInfoValue {
  /**
   * WHICH STOREFRONT — and it is a FILTER, not a fact the order stores: the shop already carries its
   * own marketplace, so this exists to cut a team's shop list down to the one the person is looking
   * at. UNSPECIFIED = no narrowing, every shop.
   *
   * ⚠ Changing it CLEARS a shop that is not on it (ShopSelect emits the clear). A shop the list no
   * longer offers must not stay silently selected.
   */
  marketplace: Marketplace;
  /** The shop that took the order (0n = none picked yet). */
  shopId: bigint;
  /** The marketplace's OWN id for this order — what the person reads off the storefront. */
  orderExternalRefId: string;
  /**
   * What the storefront actually took, in RAW DIGITS (CurrencyInput's contract — no separators).
   * "" or "0" means nobody wrote it down.
   */
  marketplaceTotal: string;
}

export const emptyMarketplaceInfo: MarketplaceInfoValue = {
  marketplace: Marketplace.UNSPECIFIED,
  shopId: 0n,
  orderExternalRefId: "",
  marketplaceTotal: "0",
};

// The server's ceiling for a draft's `external_id` (selling/v1 order_draft.proto). Enforced here too
// so the field simply stops accepting characters rather than letting a paste through and failing on
// submit — a marketplace reference is pasted, not typed, and a silently truncated one is worse than
// a full one that was refused.
const MAX_REF_LEN = 128;

// MarketplaceInfoForm collects the marketplace side of an order: its shop, its external reference
// and what the storefront took. It is CONTROLLED and carries no card, heading or submit of its own —
// the screen using it owns its chrome, so the same block reads identically on the create form, on a
// draft, and in an edit dialog.
//
// ⚠ The total here is a NOTE, never an input to arithmetic. The order's own `total` stays
// subtotal + shipping; folding this in would count the same sale twice.
export const description =
  "The marketplace side of an order — the storefront (which scopes the shop list), its shop, the storefront's own order reference, and what it took. Controlled, unchromed: emits { marketplace, shopId, orderExternalRefId, marketplaceTotal }.";

export function MarketplaceInfoForm({
  teamId,
  value,
  onChange,
  disabled,
  required = false,
}: {
  /** The selling team whose shops can be picked — a shop is team-scoped. */
  teamId: bigint;
  value: MarketplaceInfoValue;
  onChange: (value: MarketplaceInfoValue) => void;
  disabled?: boolean;
  /** Marks the shop as required. The reference stays optional — a phone order never has one. */
  required?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Stack gap="card" data-testid="marketplace-info-form">
      {/* THE STOREFRONT AND ITS SHOP, ON ONE LINE (owner) — read left to right, which is the order
          they are answered in: a team on six marketplaces has a shop list nobody scans, and naming
          the marketplace first cuts it to the two or three shops that could possibly be right.

          Side by side rather than stacked because the second is a REFINEMENT of the first, not a
          separate question — the narrowing is visible when both are in view, and a stack would put
          the filter's effect below the fold on a phone. They collapse to one column at `base`, where
          the pair cannot fit without squeezing both. */}
      <SimpleGrid columns={{ base: 1, md: 2 }} gap="card" alignItems="start">
        {/* A FILTER, not a field of the order: nothing is submitted from it — the shop carries its own
            marketplace. */}
        <Field.Root disabled={disabled}>
          <Field.Label>{t("orders.marketplace")}</Field.Label>
          <MarketplaceSelect
            value={value.marketplace}
            onChange={(marketplace) => onChange({ ...value, marketplace })}
            placeholder={t("orders.marketplaceAll")}
            disabled={disabled}
          />
          <Field.HelperText>{t("orders.marketplaceHelp")}</Field.HelperText>
        </Field.Root>

        <Field.Root required={required} disabled={disabled}>
          <Field.Label>{t("orders.shop")}</Field.Label>
          <ShopSelect
            teamId={teamId}
            value={value.shopId}
            marketplace={value.marketplace}
            onChange={(shopId) => onChange({ ...value, shopId })}
            disabled={disabled}
          />
        </Field.Root>
      </SimpleGrid>

      {/* The storefront's own name for the order. Left as free text on purpose: every marketplace
          formats its reference differently, and a mask would refuse the next one we meet. */}
      <Field.Root disabled={disabled}>
        <Field.Label>{t("orders.orderExternalRefId")}</Field.Label>
        <Input
          value={value.orderExternalRefId}
          maxLength={MAX_REF_LEN}
          placeholder={t("orders.orderExternalRefIdPlaceholder")}
          data-testid="order-external-ref-id"
          onChange={(e) => onChange({ ...value, orderExternalRefId: e.target.value })}
        />
        <Field.HelperText>{t("orders.orderExternalRefIdHelp")}</Field.HelperText>
      </Field.Root>

      {/* What the storefront actually took, after its vouchers, coin subsidies and promotions. It sits
          HERE rather than beside the order's own totals on purpose: a money field placed under a Total
          reads as a term of it whatever the caption says, and this one is never summed into anything. */}
      <Field.Root disabled={disabled}>
        <Field.Label>{t("orders.marketplaceTotal")}</Field.Label>
        <CurrencyInput
          value={value.marketplaceTotal}
          data-testid="order-marketplace-total"
          onChange={(marketplaceTotal) => onChange({ ...value, marketplaceTotal })}
        />
        <Field.HelperText>{t("orders.marketplaceTotalHelp")}</Field.HelperText>
      </Field.Root>
    </Stack>
  );
}
