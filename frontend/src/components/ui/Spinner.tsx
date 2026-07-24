import { Loader2 } from "lucide-react";
import { cn } from "./cn";

// The app's Spinner, replacing Chakra's. A spinning lucide loader tinted with the accent token.
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-accent", className)} aria-label="Loading" />;
}
