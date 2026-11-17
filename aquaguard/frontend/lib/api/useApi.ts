"use client";
/** Minimal data hook: keyed in-memory cache, loading/error states, retry, stale-response protection.
 * A manual refresh (store.bumpData) clears the cache and refetches every mounted view. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../store";

const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 5 * 60 * 1000;

export function clearApiCache(): void {
  cache.clear();
}

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  retry: () => void;
}

export function useApi<T>(key: string | null, fetcher: () => Promise<T>): ApiState<T> {
  const hit = key ? cache.get(key) : undefined;
  const fresh = hit && Date.now() - hit.at < TTL_MS ? (hit.data as T) : undefined;
  const [result, setResult] = useState<{
    key: string | null; data: T | undefined; error: Error | undefined; loading: boolean;
  }>({ key, data: fresh, error: undefined, loading: !fresh && key !== null });
  const [nonce, setNonce] = useState(0);
  const version = useAppStore((s) => s.dataVersion);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS && nonce === 0) {
      setResult({ key, data: cached.data as T, error: undefined, loading: false });
      return;
    }
    let cancelled = false;
    setResult((current) => ({ key, data: current.key === key ? current.data : undefined,
      error: undefined, loading: true }));
    fetcherRef
      .current()
      .then((d) => {
        if (cancelled) return;
        cache.set(key, { at: Date.now(), data: d });
        setResult({ key, data: d, error: undefined, loading: false });
      })
      .catch((e: Error) => {
        if (!cancelled) setResult((current) => ({ key, data: current.key === key ? current.data : undefined,
          error: e, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce, version]);

  const retry = useCallback(() => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  const matches = result.key === key;
  return {
    data: key === null ? undefined : matches ? result.data : fresh,
    error: key !== null && matches ? result.error : undefined,
    loading: key !== null && (matches ? result.loading : !fresh),
    retry,
  };
}
