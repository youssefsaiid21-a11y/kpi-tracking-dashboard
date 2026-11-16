/**
 * Shared QueryClient factory — used by both server prefetch and client Providers.
 *
 * Keeps staleTime, gcTime, and retry logic identical so server-dehydrated
 * data is treated as fresh by the client QueryClient.
 */

import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,      // 5 minutes
        gcTime: 10 * 60 * 1000,         // 10 minutes
        retry: (failureCount, error) => {
          // Don't retry auth errors — redirect to login on client
          if (
            typeof window !== "undefined" &&
            error &&
            typeof error === "object" &&
            "status" in error &&
            (error as any).status === 401
          ) {
            const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?callbackUrl=${callbackUrl}`;
            return false;
          }
          return failureCount < 1;
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}
