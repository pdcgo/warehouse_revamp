import { useEffect, useState } from "react";
import { rpcError, shippingClient } from "../../api/clients";
import type { Shipping } from "../../gen/warehouse/shipping/v1/shipping_pb";

// The courier catalogue, loaded ONCE per session and shared by every component that needs it (#126).
//
// Why this is not a plain useEffect in each component: a courier is rendered per table ROW
// (ShippingBadge), so a per-instance fetch would fire one ShippingList call per row — ~20 for a
// single page of restock requests. The catalogue is curated, rarely-changing reference data (it is
// the one list CLAUDE.md exempts from pagination for exactly that reason), so a session cache is the
// right shape:
//
//   - `cache` holds the resolved catalogue. A caller arriving after the load makes NO request.
//   - `inflight` is the single shared Promise, so N components mounting in the same tick await ONE
//     request instead of racing N of them.
//
// The catalogue does change in one place — ShippingChannelsPage, where root/admin curate it. That
// page calls invalidateShippingCatalogue() after every mutation, so a renamed courier does not keep
// its old name in every badge for the rest of the session.
let cache: Shipping[] | null = null;
let inflight: Promise<Shipping[]> | null = null;
// Bumped on invalidation so a response that was already in flight cannot resurrect a cache that has
// since been dropped.
let generation = 0;

export function loadShippingCatalogue(): Promise<Shipping[]> {
  if (cache !== null) return Promise.resolve(cache);
  if (inflight !== null) return inflight;

  const gen = generation;

  const request = shippingClient
    .shippingList({})
    .then((res) => {
      if (gen === generation) {
        cache = res.data;
        inflight = null;
      }
      return res.data;
    })
    .catch((err: unknown) => {
      // A failed load is never cached — the next caller retries.
      if (gen === generation) inflight = null;
      throw err;
    });

  inflight = request;
  return request;
}

// Drops the session cache. Call it after anything that CHANGES the catalogue.
export function invalidateShippingCatalogue() {
  cache = null;
  inflight = null;
  generation++;
}

export interface ShippingCatalogue {
  couriers: Shipping[];
  loading: boolean;
  error: string;
}

// useShippingCatalogue subscribes a component to the shared catalogue: it renders from the cache on
// the first paint if the catalogue is already loaded, and otherwise re-renders when the one shared
// request resolves.
export function useShippingCatalogue(): ShippingCatalogue {
  const [couriers, setCouriers] = useState<Shipping[]>(() => cache ?? []);
  const [loading, setLoading] = useState(() => cache === null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cache !== null) {
      setCouriers(cache);
      setLoading(false);
      return;
    }

    let alive = true;

    loadShippingCatalogue()
      .then((list) => {
        if (!alive) return;
        setCouriers(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(rpcError(err));
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  return { couriers, loading, error };
}

// courierName maps a stored courier CODE to its human name. It falls back to the raw code when the
// courier is unknown or the catalogue has not loaded yet — a courier always renders as *something*,
// never as a blank.
export function courierName(couriers: Shipping[], code: string): string {
  const match = couriers.find((courier) => courier.code === code);
  return match?.name ?? code;
}
