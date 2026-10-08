// Public API shapes. Nothing in here may carry an email address or a raw payout ID.

export type BillStatus = "in_transit" | "holding" | "wild" | "complete" | "eulogized";
export type FollowPreference = "every_hop" | "on_end";

export type Personality = {
  name: string;        // "Dolores, a restless dollar with a coffee problem"
  tagline: string;     // one-line self description
  voice: string;       // tone keywords, used in every prompt
  quirks: string[];
};

export type Receipt = {
  mode: "sandbox" | "mock" | "seed";
  item: string;        // masked payout item id, e.g. "••••7QX2"
  status: string;      // SUCCESS | UNCLAIMED | ...
};

export type PublicHop = {
  idx: number;
  words: string;
  contentWords: number;
  penName: string | null;
  place: string;       // "Austin, TX" or "Somewhere"
  lat: number | null;
  lng: number | null;
  note: string | null;
  stampUrl: string | null;
  stampStatus: "pending" | "ready" | "failed" | "none";
  receipt: Receipt | null;
  inherited: boolean;
  confirmedAt: number;
};

export type PublicDiary = {
  kind: string;
  dayLabel: string | null;
  text: string;
  createdAt: number;
};

export type BillSummary = {
  serial: string;
  status: BillStatus;
  theme: string | null;
  personaName: string;
  hopCount: number;
  wordCount: number;
  followerCount: number;
  goalHops: number | null;
  originCity: string | null;
  lastPlace: string | null;
  teaser: string;      // last ~12 words of the story
  createdAt: number;
  featured: boolean;
  isSeed: boolean;
};

export type PublicBill = {
  serial: string;
  status: BillStatus;
  theme: string | null;
  goalHops: number | null;
  personality: Personality;
  originCity: string | null;
  createdAt: number;
  endedAt: number | null;
  hopCount: number;
  wordCount: number;
  followerCount: number;
  featured: boolean;
  isSeed: boolean;
  version: number;
  holderPlace: string | null;
  holderSince: number | null;
  wildSince: number | null;
  forkedFrom: { serial: string; atHop: number } | null;
  forks: { serial: string; atHop: number; hopCount: number; status: BillStatus }[];
  finale: { text: string; by: "creator" | "bill" } | null;
  eulogy: string | null;
  hops: PublicHop[];
  diary: PublicDiary[];
};

export type HolderView =
  | { state: "invalid" }
  | { state: "moved_on" }
  | { state: "ended" }
  | { state: "arriving"; paypalStatus: string | null; mode: string }
  | {
      state: "holding";
      followerCount: number;
      suggestionsLeft: number;
      place: { city: string | null; region: string | null; country: string | null };
      lastFailure: { recipient: string; error: string; words: string } | null;
      viaWild: boolean;
      holderSince: number;
    }
  | {
      state: "in_transit";
      recipient: string;   // masked
      paypalStatus: string | null;
      mode: string;
      words: string;
    };

export type CreatorView =
  | { valid: false }
  | { valid: true; canEnd: boolean; status: BillStatus; hopCount: number; goalHops: number | null };

export type AppConfig = {
  paypalMode: "sandbox" | "mock";
  paypalClientId: string | null;
};

export type HomeData = {
  stats: { traveling: number; words: number; cities: number; hops: number };
  featured: BillSummary[];
  recent: BillSummary[];
  wild: BillSummary[];
};
