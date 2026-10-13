"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.error ?? {};
    throw new ApiError(err.code ?? `http_${res.status}`, err.detail ?? res.statusText);
  }
  return body as T;
}

export function postJson<T>(url: string, data: unknown) {
  return api<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

/** Fetches `url` now and every `intervalMs` while the tab is visible. */
export function usePolling<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!url || inFlight.current) return;
    inFlight.current = true;
    try {
      setData(await api<T>(url));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { data, setData, error, refresh };
}

export function timeAgo(iso: string) {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export function short(value: string | null | undefined, head = 6, tail = 4) {
  if (!value) return "—";
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
