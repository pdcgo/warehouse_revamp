import { useEffect, useState } from "react";
import { NativeSelect } from "@chakra-ui/react";
import { rpcError, shopClient } from "../api/clients";
import type { Shop } from "../gen/warehouse/selling/v1/selling_pb";
import { marketplaceLabel } from "./MarketplaceSelect";

export interface ShopSelectProps {
  /** The selling team whose shops to list — a shop is team-scoped, so this is required. */
  teamId: bigint;
  /** Selected shop id (0n = none). */
  value?: bigint;
  onChange?: (shopId: bigint) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ShopSelect is the shared marketplace-shop picker for a selling team (#90). A team runs a handful of
// shops, so — like ShippingSelect over the courier catalogue — it loads them all once into a
// NativeSelect rather than paging or searching. It emits a shop id; the label shows the shop's name
// and its marketplace so two shops with similar names stay distinguishable.
export const description = "Marketplace-shop picker for a selling team (NativeSelect over ShopList). Emits a shop id; labels each shop with its marketplace.";

export function ShopSelect({
  teamId,
  value,
  onChange,
  placeholder = "Select a shop",
  disabled,
}: ShopSelectProps) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (teamId <= 0n) {
      setShops([]);
      return;
    }

    let alive = true;

    shopClient
      .shopList({ teamId, q: "", page: { page: 1, limit: 100 } })
      .then((res) => {
        if (alive) setShops(res.shops);
      })
      .catch((err) => {
        if (alive) setError(rpcError(err));
      });

    return () => {
      alive = false;
    };
  }, [teamId]);

  return (
    <NativeSelect.Root disabled={disabled}>
      <NativeSelect.Field
        data-testid="shop-select"
        value={value && value > 0n ? value.toString() : ""}
        onChange={(e) => onChange?.(e.target.value ? BigInt(e.target.value) : 0n)}
      >
        <option value="" disabled>
          {error ? "Shops unavailable" : placeholder}
        </option>
        {shops.map((shop) => (
          <option key={shop.id.toString()} value={shop.id.toString()}>
            {shop.name} · {marketplaceLabel(shop.marketplace)}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
