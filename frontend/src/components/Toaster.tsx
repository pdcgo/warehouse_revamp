import { Toaster as SonnerToaster, toast } from "sonner";
import "sonner/dist/styles.css";
import { useColorMode } from "../lib/colorMode";

// The app's toasts, on sonner (replacing Chakra's createToaster). The PUBLIC surface is unchanged —
// `toaster.create({ title, description, type })` and the `<Toaster />` mount — so the ~87 call sites
// and main.tsx are untouched. sonner owns the queue, the ARIA live region, pause-on-idle and dismiss.
type ToastType = "success" | "error" | "info" | "loading" | "broken";

interface ToastOptions {
  title: string;
  description?: string;
  type?: ToastType;
}

export const toaster = {
  create({ title, description, type = "info" }: ToastOptions) {
    const opts = description ? { description } : undefined;
    switch (type) {
      case "success":
        return toast.success(title, opts);
      // "broken" is the app's stock-received-damaged notice — an error-shaped warning.
      case "error":
      case "broken":
        return toast.error(title, opts);
      case "loading":
        return toast.loading(title, opts);
      default:
        return toast(title, opts);
    }
  },
};

// Follows the app's color mode (the [data-theme] signal via useColorMode). `richColors` gives the
// green/red success/error treatment the old Chakra indicator carried.
export function Toaster() {
  const mode = useColorMode();
  return (
    <SonnerToaster
      theme={mode}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{ style: { fontFamily: "var(--font-sans)" } }}
    />
  );
}
