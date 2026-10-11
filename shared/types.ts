// Public API shapes. Nothing in here may carry an email address or a raw payout ID.

export type BillStatus = "in_transit" | "holding" | "wild" | "complete" | "eulogized";
export type FollowPreference = "every_hop" | "on_end";

export type Personality = {
  name: string;        // "Dolores, a restless dollar with a coffee problem"
  tagline: string;     // one-line self description
  voice: string;       // tone keywords, used in every prompt
  quirks: string[];
};

export type PayPalMode = "live" | "sandbox" | "mock";

export type Receipt = {
  mode: PayPalMode | "seed";
  item: string;        // masked payout item id, e.g. "••••7QX2"
  status: string;      // SUCCESS | UNCLAIMED | ...
};

export type PublicHop = {
  idx: number;
  words: string;
  contentWords: number;
  penName: string | null;
  /** Signed with a pen name its writer claimed on their account. */
  penVerified: boolean;
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
  paymentMode: PayPalMode;
  placeCount: number;
  history: { olderBefore: number | null; newerAfter: number | null };
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

/**
 * Private to the person a buck was passed to, and it outlives their turn: it lets them follow the
 * story or get a sign-in code at the address it was sent to, without the page ever seeing that address.
 */
export type HolderTicket = { token: string; email: string /* masked */ };

/** Who's holding, as far as accounts go: set only when the signed-in account is the one it was passed to. */
type HolderIdentity = { ticket: HolderTicket; account: { handle: string | null } | null };

export type HolderView =
  | { state: "invalid" }
  | { state: "moved_on" }
  | { state: "ended" }
  | ({ state: "arriving"; paypalStatus: string | null; mode: string } & HolderIdentity)
  | ({
      state: "holding";
      followerCount: number;
      suggestionsLeft: number;
      place: { city: string | null; region: string | null; country: string | null };
      lastFailure: PassFailure | null;
      viaWild: boolean;
      holderSince: number;
      /** Set when the bill came back to you: the person you passed it to sent it back. Your words are already in. */
      returnedBy: string | null;   // masked
      /** Where it goes if you send it back: whoever passed it to you, or the wild if you claimed it. */
      sendBackTo: "sender" | "wild";
    } & HolderIdentity)
  | ({
      state: "in_transit";
      recipient: string;   // masked
      paypalStatus: string | null;
      mode: string;
      words: string;
    } & HolderIdentity);

/** The latest payout that didn't reach the person you picked. */
export type PassFailure = { recipient: string; error: string; words: string; timedOut: boolean };

export type CreatorView =
  | { valid: false }
  | {
      valid: true;
      canEnd: boolean;
      status: BillStatus;
      hopCount: number;
      goalHops: number | null;
      /** Set when your first holder sent the bill back to you: pick someone new. */
      returnedBy: string | null;
      lastFailure: PassFailure | null;
    };

export type AppConfig = {
  paypalMode: PayPalMode;
  paypalClientId: string | null;
};

/** One PayPal movement in Open Books. References are masked; no emails, no internal ids. */
export type BooksRow = {
  id: string;            // opaque, stable
  at: number;
  direction: "in" | "out";
  amount: number;        // dollars
  kind: "release" | "fork" | "comp" | "first_holder" | "claim" | "pass";   // comp: an admin release with no checkout ($0 in)
  serial: string;
  hop: number | null;    // the hop whose words rode on this payout
  paypalStatus: string;  // COMPLETED | UNCLAIMED | SUCCESS | PENDING | FAILED | ...
  outcome: "landed" | "in_flight" | "failed";
  ref: string;           // "••••ZZ4H"
  secondsToLand: number | null;
  settledBy: "webhook" | "polling" | null;
  webhook: boolean;      // a signed PayPal webhook arrived for it
  mode: PayPalMode;
};

export type OpenBooks = {
  totals: { paidIn: number; checkouts: number; paidOut: number; payouts: number; inFlight: number; failed: number; heldForWild: number };
  rows: BooksRow[];
  words: { holders: number; hops: number; creatorFinales: number; billClosings: number };
  voice: { model: string; pieces: number; kind: "writing" | "stamps" }[];
  generatedAt: number;
};

export type HomeData = {
  stats: { traveling: number; words: number; cities: number; hops: number };
  featured: BillSummary[];
  recent: BillSummary[];
  wild: BillSummary[];
};

/** The signed-in account. The email is the account's own, shown only to its owner. */
export type Me = { firstName: string | null; lastName: string | null; email: string; handle: string | null; isAdmin: boolean; createdAt: number };

export type DashboardHop = {
  serial: string;
  personaName: string;
  idx: number;
  words: string;
  place: string;
  penName: string | null;
  penVerified: boolean;
  stampUrl: string | null;
  stampStatus: PublicHop["stampStatus"];
  confirmedAt: number;
  opening: boolean;    // the foreword of a bill you started
};

/** Everything a person has done, found by their participant id, including what they did before signing up. */
export type Dashboard = {
  me: Me;
  stats: { hops: number; words: number; held: number; started: number; places: number };
  /** Bucks waiting on you: four words to write, a returned buck to pass again, or a dollar on its way. */
  inHand: (BillSummary & { action: "write" | "repass" | "arriving" })[];
  started: BillSummary[];
  hops: DashboardHop[];
  following: { id: string; serial: string; personaName: string; status: BillStatus; preference: FollowPreference }[];
};
