import { QueryClient } from "@tanstack/react-query";

/** The app's single query client, importable outside React (e.g. from stores) to refresh lists. */
export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } });
