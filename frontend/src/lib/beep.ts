// THE SCANNER'S TWO SOUNDS — "fulfilled" and "wrong" — made by the browser, with no audio file.
//
// A crew scanning a pile of parcels is looking at the parcels, not the screen; the sound is the answer.
// Two tones that cannot be mistaken for each other: a short high beep for a scan that did what was
// asked (or one that was already done — a duplicate is not a mistake), and a low, longer buzz for one
// that did not.
//
// ⚠ IT FAILS SILENT. No AudioContext (an old browser, a test runner without audio, a page that has not
// been interacted with yet) means no sound — never an error in the middle of a scan.

export type BeepKind = "fulfilled" | "wrong";

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context = context ?? new Ctor();
    return context;
  } catch {
    return null;
  }
}

export function beep(kind: BeepKind): void {
  const ctx = audio();
  if (!ctx) return;

  try {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const length = kind === "fulfilled" ? 0.12 : 0.32;

    oscillator.type = kind === "fulfilled" ? "sine" : "square";
    oscillator.frequency.value = kind === "fulfilled" ? 1046 : 196;
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + length);
  } catch {
    // Sound is a courtesy; a scan never fails because the speaker did.
  }
}
