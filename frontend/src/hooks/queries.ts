import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Account, Health, Runtime } from "@/types";

export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: () => api.get<Account[]>("/api/accounts") });
export const useRuntime = () => useQuery({ queryKey: ["runtime"], queryFn: () => api.get<Runtime>("/api/settings/runtime"), staleTime: 60_000 });
export const useHealth = () => useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/health/details"), refetchInterval: 30_000 });
