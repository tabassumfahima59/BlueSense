"use client";
/** Minimal data hook: keyed in-memory cache, loading/error states, retry, stale-response protection. */
import { useCallback, useEffect, useRef, useState } from "react";

const cache = new Map<string, { at: number; data: unknown }>();
const TTL_MS = 5 * 60 * 1000;

export interface ApiState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  retry: () => void;
}

export function useApi<T>(key: string | null, fetcher: () => Promise<T>): ApiState<T> {
  const hit = key ? cache.get(key) : undefined;
  const fresh = hit && Date.now() - hit.at < TTL_MS ? (hit.data as T) : undefined;
  const [data, setData] = useState<T | undefined>(fresh);
  const [error, setError] = useState<Error | undefined>();
  const [loading, setLoading] = useState<boolean>(!fresh && key !== null);
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TTL_MS && nonce === 0) {
      setData(cached.data as T);
      setError(undefined);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetcherRef
      .current()
      .then((d) => {
        if (cancelled) return;
        cache.set(key, { at: Date.now(), data: d });
        setData(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [key, nonce]);

  const retry = useCallback(() => {
    if (key) cache.delete(key);
    setNonce((n) => n + 1);
  }, [key]);

  return { data, error, loading, retry };
}
