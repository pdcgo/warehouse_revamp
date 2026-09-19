import { useEffect, useState } from "react";

// The typed value, held back until typing pauses.
//
// Every search picker in the app debounced by hand — a setTimeout inside the same effect that
// fetched, cleared on cleanup. Once the fetching moved into a query, that effect had nothing left to
// do except this, and three copies of a timer is three chances to pick a different delay or forget
// the cleanup.
//
// Note what it is FOR now. It used to serve correctness as well: without it a stale reply could land
// after a newer one. The cache owns that question now — a response for a key that is no longer
// current is not the component's data — so this exists purely to keep the request count down while
// somebody is mid-word.
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);

    return () => clearTimeout(timer);
  }, [value, ms]);

  return settled;
}
