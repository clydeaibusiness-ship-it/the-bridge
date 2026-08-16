"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback } from "react";
import { apiGet, apiPost } from "./api";

// Wraps the API helpers with the current Clerk session token, so every call is
// authenticated without each component reaching for getToken itself.
export function useApi() {
  const { getToken } = useAuth();
  const get = useCallback(
    async <T,>(path: string) => apiGet<T>(path, await getToken()),
    [getToken]
  );
  const post = useCallback(
    async <T,>(path: string, body: unknown) => apiPost<T>(path, body, await getToken()),
    [getToken]
  );
  return { get, post };
}
