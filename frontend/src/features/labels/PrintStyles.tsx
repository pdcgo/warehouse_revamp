import type { LabelSettings } from "./settings";

// SHARED by every product label print (Cetak Label, a return's relabel): mount it beside a `.labels-print-root` of
// LabelPapers and call `window.print()` — the browser's own dialog, which is where a PDF is saved too
// (cetak-is-the-one-print-button).
//
// The page's print rules — the page's size IS the paper's, no margin; the app and everything but the run's papers is
// dropped; one paper a page. Written with the settings in it, because `@page` takes no variables.
export function PrintStyles({ settings }: { settings: LabelSettings }) {
  return (
    <style>{`
      .labels-print-root { display: none; }
      @media print {
        @page { size: ${settings.paperWidth}mm ${settings.paperHeight}mm; margin: 0; }
        html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
        body > *:not(.labels-print-root) { display: none !important; }
        .labels-print-root { display: block !important; }
        .labels-print-root .label-paper { break-after: page; page-break-after: always; }
        .labels-print-root .label-paper:last-child { break-after: auto; page-break-after: auto; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `}</style>
  );
}
