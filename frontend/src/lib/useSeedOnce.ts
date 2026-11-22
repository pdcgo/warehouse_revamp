import { useState } from "react";

// A FORM SEEDED FROM A READ IS SEEDED ONCE PER RECORD — then it is the person's.
//
// Every read is a query hook (no-global-store-every-read-is-a-query-hook), and every query is always fresh (HARD RULE
// 10): it answers again on a remount, on an invalidation another write sends, on a closure added beside the form. An
// edit form that copied each answer into its fields would throw away whatever the person had typed the moment one
// arrived. So the fields take the read's answer ONCE for a record, and never again while the form is open on it.
//
// ⚠ THE ANSWER IT TAKES IS ONE GIVEN SINCE THIS SCREEN MOUNTED (`answered` = the query's `isFetchedAfterMount`), never
// a cached one left by an earlier visit: a form seeded from a cache entry would show the record as it was, and the
// fresh answer arriving a beat later would be the one it must ignore. Until then the page shows its loading shape, as
// the old one-shot read did.
//
// `id` names the record (and the team): another record is another seed. `seed` copies the answer into the form's own
// state — it runs during render, as React's "storing information from previous renders" allows for a component's own
// state, so the form never paints a frame of empty fields. Returns whether the form holds this record yet.
export function useSeedOnce(id: string, answered: boolean, seed: () => void): boolean {
  const [seededFor, setSeededFor] = useState<string | null>(null);

  if (answered && seededFor !== id) {
    setSeededFor(id);
    seed();
  }

  return seededFor === id;
}
