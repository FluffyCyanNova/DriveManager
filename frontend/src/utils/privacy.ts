import { create } from "zustand";

/**
 * "Hide emails" privacy mode (for screenshots or screen sharing). Display only: real addresses are still used for
 * every API call. Each email gets a stable alias (same email, same alias) so accounts stay distinguishable.
 */
const KEY = "dm-hide-emails";
const initial = (() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } })();

export const usePrivacy = create<{ hideEmails: boolean; toggleHideEmails: () => void }>((set, get) => ({
  hideEmails: initial,
  toggleHideEmails: () => {
    const hideEmails = !get().hideEmails;
    try { localStorage.setItem(KEY, hideEmails ? "1" : "0"); } catch { /* storage unavailable */ }
    set({ hideEmails });
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
}

export const makeMask = (hide: boolean): Mask => ({
  hide,
  email: (e) => (hide && e ? emailAlias(e) : e),
  text: (t) => (hide && t ? maskText(t) : t),
  name: (n) => (hide ? null : n),
});

/** Subscribe a component to the privacy setting and get display helpers. */
export function useMask(): Mask {
  return makeMask(usePrivacy((s) => s.hideEmails));
}
