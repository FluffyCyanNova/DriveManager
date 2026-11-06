import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Account, Health, Runtime } from "@/types";
import { registerAccounts } from "@/utils/accountColor";

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: async () => { const list = await api.get<Account[]>("/api/accounts"); registerAccounts(list); return list; } });
export const useRuntime = () => useQuery({ queryKey: ["runtime"], queryFn: () => api.get<Runtime>("/api/settings/runtime"), staleTime: 60_000 });
export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/health/details"), refetchInterval: 30_000 });
