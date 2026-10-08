import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, BillSummary, CreatorView, FollowPreference, HolderView, HomeData, OpenBooks, PublicBill } from "../shared/types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data;
}

export type MintBody = {
  orderId: string;
  creatorEmail: string;
  words: string;
  theme?: string | null;
  goal?: number | null;
  firstRecipient?: string | null;
  penName?: string | null;
  showCity?: boolean;
};

export const api = {
  config: () => req<AppConfig & { place?: string | null }>("/api/config"),
  home: () => req<HomeData>("/api/home"),
  wild: () => req<BillSummary[]>("/api/wild"),
  books: () => req<OpenBooks>("/api/books"),
  bill: (serial: string) => req<PublicBill>(`/api/bills/${serial}`),
  version: (serial: string) => req<{ v: number }>(`/api/bills/${serial}/v`),
  holder: (serial: string, t: string) => req<HolderView>(`/api/bills/${serial}/holder?t=${encodeURIComponent(t)}`),
  creator: (serial: string, c: string) => req<CreatorView>(`/api/bills/${serial}/creator?c=${encodeURIComponent(c)}`),
  checkout: (purpose: "mint" | "fork") => req<{ orderId: string }>("/api/checkout", { purpose }),
  mint: (body: MintBody) => req<{ serial: string; creatorToken: string }>("/api/bills", body),
  fork: (serial: string, body: MintBody & { atHop: number }) => req<{ serial: string; creatorToken: string }>(`/api/bills/${serial}/fork`, body),
  contribute: (serial: string, body: { t: string; words: string; next: string | null; note?: string; penName?: string; showCity: boolean; aiAssisted: boolean }) =>
    req<{ state: "wild" | "in_transit" }>(`/api/bills/${serial}/contribute`, body),
  suggest: (serial: string, body: { t?: string; c?: string; mode?: "finale" }) => req<{ options: string[]; left?: number }>(`/api/bills/${serial}/suggest`, body),
  claim: (serial: string, email: string) => req<{ token: string }>(`/api/bills/${serial}/claim`, { email }),
  follow: (serial: string, email: string, preference: FollowPreference) => req<{ ok: true }>(`/api/bills/${serial}/follow`, { email, preference }),
  finale: (serial: string, c: string, words: string) => req<{ ok: true }>(`/api/bills/${serial}/finale`, { c, words }),
  resend: (serial: string) => req<{ ok: true }>(`/api/bills/${serial}/resend`, {}),
  followGet: (id: string, t: string) => req<{ preference: FollowPreference | null; serial: string | null }>(`/api/follows/${id}?t=${encodeURIComponent(t)}`),
  followSet: (id: string, t: string, preference: FollowPreference | "unfollow") => req<{ ok: true }>(`/api/follows/${id}`, { t, preference }),
};

/** Fetch once, keep the last good value. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fn().then(setData, (e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

/** A bill that stays live: polls a cheap version number and refetches on change. */
export function useLiveBill(serial: string) {
  const [bill, setBill] = useState<PublicBill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(-2);

  const refresh = useCallback(async () => {
    try {
      const b = await api.bill(serial);
      version.current = b.version;
      setBill(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [serial]);

  useEffect(() => {
    version.current = -2;
    setBill(null);
    refresh();
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const { v } = await api.version(serial);
        if (v !== version.current) refresh();
      } catch {
        /* offline: try again next tick */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [serial, refresh]);

  return { bill, error, refresh };
}

/** Tokens arrive in the URL from email links; move them to storage and out of the address bar. */
export function useUrlToken(param: "t" | "c", serial: string, storage: "session" | "local"): [string | null, (v: string | null) => void] {
  const key = `fwp:${param}:${serial}`;
  const store = storage === "session" ? sessionStorage : localStorage;
  const [value, setValue] = useState<string | null>(() => {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get(param);
    try {
      if (fromUrl) store.setItem(key, fromUrl);
      return fromUrl ?? store.getItem(key);
    } catch {
      return fromUrl;
    }
  });
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param);
      history.replaceState(history.state, "", url.pathname + url.search + url.hash);
    }
  }, [param]);
  const set = useCallback(
    (v: string | null) => {
      try {
        if (v) store.setItem(key, v);
        else store.removeItem(key);
      } catch {
        /* storage blocked */
      }
      setValue(v);
    },
    [key, store],
  );
  return [value, set];
}
