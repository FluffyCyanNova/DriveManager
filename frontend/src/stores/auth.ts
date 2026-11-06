import { create } from "zustand";

interface AuthState {
  status: "loading" | "in" | "out";
  username: string | null;
  csrf: string | null;
  set: (s: { status: "in" | "out"; username?: string | null; csrf?: string | null }) => void;
}
export const useAuth = create<AuthState>((set) => ({
  status: "loading", username: null, csrf: null,
  set: (s) => set({ status: s.status, username: s.username ?? null, csrf: s.csrf ?? null }),
}));
