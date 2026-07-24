import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";

// The app's Table, replacing Chakra's Table namespace — semantic <table> elements styled to the mock
// look (uppercase column headers, hairline row borders). Same part names, so migrating is an import
// swap. Numeric columns pass `className="text-right"`; clickable rows pass hover/cursor utilities.
function Root({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...p} />
    </div>
  );
}

function Header({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={className} {...p} />;
}

function Body({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...p} />;
}

function Footer({ className, ...p }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={cn("[&>tr>td]:border-t-2 [&>tr>td]:border-line font-semibold", className)} {...p} />;
}

function Row({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={className} {...p} />;
}

function ColumnHeader({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "border-b border-line px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[0.05em] whitespace-nowrap text-fg-subtle",
        className,
      )}
      {...p}
    />
  );
}

function Cell({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-line px-3 py-2.5 text-fg", className)} {...p} />;
}

export const Table = { Root, Header, Body, Footer, Row, ColumnHeader, Cell };
