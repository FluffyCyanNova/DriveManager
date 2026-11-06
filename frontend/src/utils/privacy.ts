import { create } from "zustand";

/**
 * "Privacy mode" (for screenshots or screen sharing). Display only: real addresses are still used for
 * every API call. Each email gets a stable alias (same email, same alias) so accounts stay distinguishable.
 */
const KEY = "dm-hide-emails";
const initial = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

const NAMES_KEY = "dm-fake-names";
const initialNames = (() => { try { return localStorage.getItem(NAMES_KEY) === "1"; } catch { return false; } })();

export const usePrivacy = create<{ hideEmails: boolean; toggleHideEmails: () => void; fakeNames: boolean; setFakeNames: (v: boolean) => void }>((set, get) => ({
  hideEmails: initial,
  toggleHideEmails: () => {
    const hideEmails = !get().hideEmails;
    try { localStorage.setItem(KEY, hideEmails ? "1" : "0"); } catch { /* storage unavailable */ }
    set({ hideEmails });
  },
  // Developer option (Settings > Developer only): show realistic made-up file and folder names. Display only, per browser.
  fakeNames: initialNames,
  setFakeNames: (fakeNames) => {
    try { localStorage.setItem(NAMES_KEY, fakeNames ? "1" : "0"); } catch { /* storage unavailable */ }
    set({ fakeNames });
  },
}));

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

/** A short random-looking alias derived from the address (FNV-1a hash), e.g. "user-k3f9x2". */
export function emailAlias(email: string): string {
  let h = 0x811c9dc5;
  const s = email.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `user-${h.toString(36).padStart(6, "0").slice(-6)}`;
}

// ---------------- fake file and folder names (demo / recording) ----------------
const ADJ = ["Quarterly", "Summer", "Autumn", "Winter", "Spring", "Annual", "Weekly", "Monthly", "Final", "Draft", "Shared", "Personal",
  "Family", "Team", "Project", "Garden", "Kitchen", "Travel", "Holiday", "Weekend", "Morning", "Evening", "Classic", "Modern",
  "Northern", "Southern", "Coastal", "Mountain", "City", "Village", "Golden", "Silver", "Green", "Blue", "Quiet", "Bright"];
const NOUN = ["Plan", "Notes", "Report", "Budget", "Recipes", "Photos", "Ideas", "Journal", "Archive", "Backup", "Sketches", "Letters",
  "Invoices", "Receipts", "Schedule", "Checklist", "Gallery", "Music", "Videos", "Drafts", "Designs", "Slides", "Records", "Maps",
  "Stories", "Projects", "Lessons", "Workshop", "Planner", "Inventory", "Portfolio", "Highlights", "Memories", "Guides", "Samples", "Research"];

const fnv = (s: string, seed = 0x811c9dc5) => { let h = seed; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

/** A stable, realistic stand-in for a file or folder name ("Quarterly Garden Plan.pdf"); the extension is kept. */
export function fakeName(real: string): string {
  if (!real) return real;
  const m = /^(.*?)(\.[A-Za-z0-9]{1,5})$/.exec(real);
  const ext = m && m[1] ? m[2].toLowerCase() : "";
  const h = fnv(real.toLowerCase()), h2 = fnv(real.toLowerCase(), 0x9747b28c);
  const words = [ADJ[h % ADJ.length], NOUN[(h >>> 8) % NOUN.length]];
  if (h2 % 3 === 0) words.splice(1, 0, NOUN[(h2 >>> 4) % NOUN.length]);        // some get a third word
  if (h2 % 5 === 0) words.push(String(2019 + (h2 % 7)));                          // and some a year
  return words.join(" ") + ext;
}
/** "My Drive / Work / Projects" with every folder name faked (the "My Drive" root stays). */
export const fakePath = (path: string) => path.split(" / ").map((p) => (p === "My Drive" ? p : fakeName(p))).join(" / ");

/** Replace every email address inside free text (server messages, toasts, allocation reasons). */
export function maskText(text: string): string {
  return text.replace(EMAIL, (m) => emailAlias(m));
}

export interface Mask {
  hide: boolean;
  /** An email address (or null) as it should be displayed. */
  email: <T extends string | null | undefined>(e: T) => T | string;
  /** Free text that may contain email addresses. */
  text: <T extends string | null | undefined>(t: T) => T | string;
  /** A person's display name: dropped entirely while hiding. */
  name: (n: string | null | undefined) => string | null | undefined;
  /** A file, folder, shared drive or virtual folder name (fake while the Developer option is on). */
  file: <T extends string | null | undefined>(n: T) => T | string;
  /** A "My Drive / A / B" path. */
  path: <T extends string | null | undefined>(p: T) => T | string;
  fakeNames: boolean;
}

export const makeMask = (hide: boolean, fake = false): Mask => ({
  hide,
  fakeNames: fake,
  email: (e) => (hide && e ? emailAlias(e) : e),
  text: (t) => (hide && t ? maskText(t) : t),
  name: (n) => (hide || fake ? null : n),
  file: (n) => (fake && n ? fakeName(n) : n),
  path: (p) => (fake && p ? fakePath(p) : p),
});

/** Subscribe a component to the privacy setting and get display helpers. */
export function useMask(): Mask {
  const hide = usePrivacy((s) => s.hideEmails);
  const fake = usePrivacy((s) => s.fakeNames);
  return makeMask(hide, fake);
}
