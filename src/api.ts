import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig, BillSummary, CreatorView, Dashboard, FollowPreference, HolderView, HomeData, Me, OpenBooks, PublicBill } from "../shared/types";

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
  orderId?: string;
  recoveryKey?: string;
  /** A signed-in admin's release without checkout. */
  free?: boolean;
  creatorEmail: string;
  words: string;
  theme?: string | null;
  goal?: number | null;
  firstRecipient?: string | null;
  penName?: string | null;
  showCity?: boolean;
  /** Signed out: make the pen name theirs. The creator-key email carries the link that creates the account. */
  createAccount?: boolean;
};

/** An account waiting on the emailed code or link. */
export type PendingAccount = { challenge: string; sentTo: string; penName: string };

export const api = {
  config: () => req<AppConfig & { place?: string | null }>("/api/config"),
  home: () => req<HomeData>("/api/home"),
  wild: () => req<BillSummary[]>("/api/wild"),
  books: () => req<OpenBooks>("/api/books"),
  bill: (serial: string, cursor: {before?: number; after?: number} = {}) => req<PublicBill>(`/api/bills/${serial}?${new URLSearchParams(Object.entries(cursor).map(([k,v]) => [k,String(v)]))}`),
  version: (serial: string) => req<{ v: number }>(`/api/bills/${serial}/v`),
  holder: (serial: string, t: string) => req<HolderView>(`/api/bills/${serial}/holder?t=${encodeURIComponent(t)}`),
  creator: (serial: string, c: string) => req<CreatorView>(`/api/bills/${serial}/creator?c=${encodeURIComponent(c)}`),
  checkout: (purpose: "mint" | "fork", recoveryKey: string) => req<{ orderId: string }>("/api/checkout", { purpose, recoveryKey }),
  mint: (body: MintBody) => req<{ serial: string; creatorToken: string }>("/api/bills", body),
  fork: (serial: string, body: MintBody & { atHop: number }) => req<{ serial: string; creatorToken: string }>(`/api/bills/${serial}/fork`, body),
  contribute: (serial: string, body: { t: string; words: string; next: string | null; note?: string; penName?: string; showCity: boolean; aiAssisted: boolean }) =>
    req<{ state: "wild" | "in_transit" }>(`/api/bills/${serial}/contribute`, body),
  suggest: (serial: string, body: { t?: string; c?: string; mode?: "finale" }) => req<{ options: string[]; left?: number }>(`/api/bills/${serial}/suggest`, body),
  claim: (serial: string, email: string | null, penName?: string) =>
    req<{ token: string; account: PendingAccount | null }>(`/api/bills/${serial}/claim`, { ...(email ? { email } : {}), ...(penName ? { penName } : {}) }),
  decline: (serial: string, t: string) => req<{ state: "returned" | "wild" }>(`/api/bills/${serial}/decline`, { t }),
  repass: (serial: string, body: { t?: string; c?: string; next: string | null }) => req<{ state: "wild" | "in_transit" }>(`/api/bills/${serial}/repass`, body),
  /** By typed email (confirmation link), by holder ticket, or as the signed-in account (no fields). */
  follow: (serial: string, as: { email?: string; ticket?: string; penName?: string }, preference: FollowPreference) =>
    req<{ ok: true; verified: boolean; account?: boolean }>(`/api/bills/${serial}/follow`, { ...as, preference }),
  finale: (serial: string, c: string, words: string) => req<{ ok: true }>(`/api/bills/${serial}/finale`, { c, words }),
  resend: (serial: string) => req<{ ok: true }>(`/api/bills/${serial}/resend`, {}),
  followGet: (id: string, t: string) => req<{ preference: FollowPreference | null; verified?: number; serial: string | null }>(`/api/follows/${id}?t=${encodeURIComponent(t)}`),
  followSet: (id: string, t: string, preference: FollowPreference | "unfollow") => req<{ ok: true }>(`/api/follows/${id}`, { t, preference }),

  me: () => req<{ me: Me | null }>("/api/me"),
  /** Email a code to a typed address, or to the one a holder ticket or creator key was sent to. */
  signInStart: (body: { email?: string; serial?: string; ticket?: string; c?: string; next?: string | null; penName?: string }) =>
    req<{ challenge: string; sentTo: string }>("/api/auth/start", body),
  signInVerify: (body: { challenge: string; code?: string; link?: string }) => req<{ me: Me; penNameTaken: string | null }>("/api/auth/verify", body),
  signOut: () => req<{ ok: true }>("/api/auth/signout", {}),
  claimPenName: (handle: string) => req<{ me: Me }>("/api/me/handle", { handle }),
  penName: (name: string) => req<{ claimed: boolean; yours: boolean }>(`/api/pen-names/${encodeURIComponent(name)}`),
  dashboard: () => req<Dashboard>("/api/me/dashboard"),
  myKeys: (serial: string) => req<{ t: string | null; c: string | null }>(`/api/me/keys/${serial}`),
  myFollow: (id: string, preference: FollowPreference | "unfollow") => req<{ ok: true }>(`/api/me/follows/${id}`, { preference }),
};

/** Fetch once, keep the last good value. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fn().then((value) => { setData(value); setError(null); }, (e: Error) => setError(e.message));
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
  const generation = useRef(0);
  const readCursor = () => {
    const params = new URLSearchParams(location.search);
    const key = params.has("before") ? "before" : params.has("after") ? "after" : null;
    const value = key ? Number(params.get(key)) : NaN;
    return key && Number.isSafeInteger(value) && value >= 0 ? {[key]: value} : {};
  };
  const [cursor, setCursor] = useState<{before?: number; after?: number}>(readCursor);
  useEffect(() => {
    const pop = () => setCursor(readCursor());
    window.addEventListener("popstate",pop);
    return () => window.removeEventListener("popstate",pop);
  }, []);
  const [loadingPage, setLoadingPage] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setLoadingPage(true);
    try {
      const b = await api.bill(serial, cursor);
      if (request !== generation.current) return;
      version.current = b.version;
      setBill(b);
      setError(null);
    } catch (e) {
      if (request !== generation.current) return;
      setError((e as Error).message);
      setErrorStatus(e instanceof ApiError ? e.status : null);
    } finally {
      if (request === generation.current) setLoadingPage(false);
    }
  }, [serial, cursor]);

  useEffect(() => {
    version.current = -2;
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
    return () => { generation.current++; clearInterval(timer); };
  }, [serial, refresh]);

  const changePage = (next: {before?: number; after?: number}) => {
    const url = new URL(location.href);
    url.searchParams.delete("before"); url.searchParams.delete("after");
    Object.entries(next).forEach(([k,v]) => url.searchParams.set(k,String(v)));
    history.pushState(history.state,"",url.pathname + url.search + url.hash);
    setCursor(next);
  };
  return { bill, error, errorStatus, refresh, changePage, loadingPage };
}

/** Tokens arrive in the URL from email links; move them to storage and out of the address bar. */
export function useUrlToken(param: "t" | "c", serial: string, storage: "session" | "local"): [string | null, (v: string | null) => void] {
  const key = `fwp:${param}:${serial}`;
  const getStore = () => storage === "session" ? sessionStorage : localStorage;
  const [value, setValue] = useState<string | null>(() => {
    const url = new URL(location.href);
    const fromUrl = url.searchParams.get(param);
    try {
      if (fromUrl) getStore().setItem(key, fromUrl);
      return fromUrl ?? getStore().getItem(key);
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
        if (v) getStore().setItem(key, v);
        else getStore().removeItem(key);
      } catch {
        /* storage blocked */
      }
      setValue(v);
    },
    [key, storage],
  );
  return [value, set];
}
