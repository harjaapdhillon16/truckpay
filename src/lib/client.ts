"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Browser-side access to LoadWallet's API v1. The UI talks to nothing else. */

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { ...init, credentials: "same-origin" });
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; detail?: string } };
  if (res.status === 401 && body.error?.code === "unauthorized" && typeof window !== "undefined") {
    // A full navigation also drops every poller still holding the signed-out session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  }
  if (!res.ok) throw new ApiError(body.error?.code ?? `http_${res.status}`, body.error?.detail ?? res.statusText, res.status);
  return body as T;
}

export function postJson<T>(path: string, data: unknown = {}, headers: Record<string, string> = {}) {
  return api<T>(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(data) });
}

/** Fetches `path` now and every `intervalMs` while the tab is visible. */
export function usePolling<T>(path: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!path || inFlight.current) return;
    inFlight.current = true;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError("network_error", "Can't reach LoadWallet. Check your connection.", 0));
    } finally {
      inFlight.current = false;
    }
  }, [path]);

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

export function idempotencyKey() {
  return crypto.randomUUID();
}
