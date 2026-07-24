import type { HTMLAttributes } from "react";
import { cn } from "./cn";

// The app's Card — a surface panel with the mock's hairline border, 12px radius and soft elevation.
export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-card border border-line bg-surface shadow-card", className)}
      {...p}
    />
  );
}

// The padded interior — separated so a card can hold a full-bleed table beside a padded header.
export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4", className)} {...p} />;
}
