import { create } from "zustand";

export interface Toast { id: number; kind: "info" | "success" | "error"; text: string }
interface UI {
  toasts: Toast[];
  push: (kind: Toast["kind"], text: string) => void;
  dismiss: (id: number) => void;
  dark: boolean;
  toggleDark: () => void;
}
let n = 0;
const initialDark = (() => { try { const v = localStorage.getItem("dm-theme"); return v ? v === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches; } catch { return false; } })();
document.documentElement.classList.toggle("dark", initialDark);

export const useUI = create<UI>((set, get) => ({
  toasts: [],
  push: (kind, text) => {
    const id = ++n;
    set({ toasts: [...get().toasts, { id, kind, text }] });
    setTimeout(() => get().dismiss(id), kind === "error" ? 9000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  dark: initialDark,
  toggleDark: () => {
    const dark = !get().dark;
    document.documentElement.classList.toggle("dark", dark);
    try { localStorage.setItem("dm-theme", dark ? "dark" : "light"); } catch { /* storage unavailable */ }
    set({ dark });
  },
}));
export const toast = {
  info: (t: string) => useUI.getState().push("info", t),
  success: (t: string) => useUI.getState().push("success", t),
  error: (t: string) => useUI.getState().push("error", t),
};
