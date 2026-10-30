#!/usr/bin/env node
// Turns stories.ts into SQL that releases hand-written demo bills into the wild.
// Seeds are flagged is_seed (labeled "Demo history"); their history is simulated, with no payouts.
//
//   node scripts/seed-wild/build.ts         (Node 22.18+ runs TypeScript directly)
//
// Writes output/seed-wild/seed.sql and users.sql. Apply them right away, since the timeline ends now:
//   1. npx wrangler d1 execute fourwordpass-db --remote --file output/seed-wild/seed.sql
//   2. When a test account doesn't exist yet, wait a minute: cron fills its hops' participant id
//      (an HMAC with the prod TOKEN_SECRET), which is the one sign-in will compute.
//   3. npx wrangler d1 execute fourwordpass-db --remote --file output/seed-wild/users.sql
// The last four hops of each story are left for cron to stamp. Our diary rows use the engine's
// `hop:<id>` ids, so cron's own diary write for those hops is ignored and only its motif is used.
//
// Test accounts sign some hops with their claimed pen names. They come from test-users.json beside
// this file (gitignored, since this repo is public): [{ "email", "handle", "home" }], where home is
// a city from CITIES. Without it, every hop is unsigned.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { SERIAL_PREFIX } from "../../shared/brand.ts";
import { checkFourWords } from "../../shared/words.ts";
import { type Hop, STORIES } from "./stories.ts";

type TestUser = { email: string; handle: string; home: string };
const usersFile = new URL("./test-users.json", import.meta.url);
const TEST_USERS: TestUser[] = existsSync(usersFile) ? JSON.parse(readFileSync(usersFile, "utf8")) : [];

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.now() - 2 * MIN;
const STAMPED = 4;

type City = [string, string, string, number, number];
const CITIES: City[] = [
  ["Austin", "TX", "US", 30.27, -97.74], ["Nashville", "TN", "US", 36.16, -86.78], ["Chicago", "IL", "US", 41.88, -87.63],
  ["Brooklyn", "NY", "US", 40.68, -73.94], ["Portland", "OR", "US", 45.52, -122.68], ["Denver", "CO", "US", 39.74, -104.99],
  ["New Orleans", "LA", "US", 29.95, -90.07], ["Seattle", "WA", "US", 47.61, -122.33], ["San Francisco", "CA", "US", 37.77, -122.42],
  ["Los Angeles", "CA", "US", 34.05, -118.24], ["Phoenix", "AZ", "US", 33.45, -112.07], ["Minneapolis", "MN", "US", 44.98, -93.27],
  ["Boston", "MA", "US", 42.36, -71.06], ["Atlanta", "GA", "US", 33.75, -84.39], ["Miami", "FL", "US", 25.76, -80.19],
  ["Salt Lake City", "UT", "US", 40.76, -111.89], ["Kansas City", "MO", "US", 39.1, -94.58], ["Detroit", "MI", "US", 42.33, -83.05],
  ["Philadelphia", "PA", "US", 39.95, -75.17], ["Asheville", "NC", "US", 35.6, -82.55], ["Santa Fe", "NM", "US", 35.69, -105.94],
  ["Anchorage", "AK", "US", 61.22, -149.9], ["Honolulu", "HI", "US", 21.31, -157.86], ["Duluth", "MN", "US", 46.79, -92.1],
  ["Houston", "TX", "US", 29.76, -95.37], ["Milwaukee", "WI", "US", 43.04, -87.91], ["Tucson", "AZ", "US", 32.22, -110.97],
  ["Toronto", "ON", "CA", 43.65, -79.38], ["Montreal", "QC", "CA", 45.5, -73.57], ["Vancouver", "BC", "CA", 49.28, -123.12],
  ["Mexico City", "CMX", "MX", 19.43, -99.13], ["Oaxaca", "OAX", "MX", 17.07, -96.73], ["London", "ENG", "GB", 51.51, -0.13],
  ["Edinburgh", "SCT", "GB", 55.95, -3.19], ["Dublin", "L", "IE", 53.35, -6.26], ["Lisbon", "11", "PT", 38.72, -9.14],
  ["Berlin", "BE", "DE", 52.52, 13.4], ["Amsterdam", "NH", "NL", 52.37, 4.9], ["Barcelona", "CT", "ES", 41.39, 2.17],
  ["Kraków", "MA", "PL", 50.06, 19.94], ["Reykjavík", "1", "IS", 64.15, -21.94], ["Tokyo", "13", "JP", 35.68, 139.69],
  ["Seoul", "11", "KR", 37.57, 126.98], ["Melbourne", "VIC", "AU", -37.81, 144.96], ["Auckland", "AUK", "NZ", -36.85, 174.76],
  ["Buenos Aires", "C", "AR", -34.6, -58.38], ["Cape Town", "WC", "ZA", -33.92, 18.42], ["Nairobi", "30", "KE", -1.29, 36.82],
];
const regionName = new Intl.DisplayNames(["en"], { type: "region" });
// Same format as placeLabel() in worker/util.ts.
const label = ([city, region, country]: City) => (country === "US" ? `${city}, ${region}` : `${city}, ${regionName.of(country)}`);
const errors: string[] = [];
const cityNamed = (name: string) => {
  const city = CITIES.find((c) => c[0] === name);
  if (!city) errors.push(`No city named ${name}`);
  return city ?? CITIES[0];
};

// Deterministic (mulberry32), so a re-run gives the same routes and signatures.
let seed = 0x46575021;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const uuid = () => crypto.randomUUID();
const q = (v: string | number | null | undefined) =>
  v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${v.replace(/'/g, "''")}'`;
const AI_META = JSON.stringify({ model: "claude-opus-5-5", prompt: "seed-handwritten" });

const sql: string[] = [];
const summary: string[] = [];

STORIES.forEach((story, order) => {
  const hops: Hop[] = story.hops.map((h) => (typeof h === "string" ? { w: h } : h));
  hops.forEach((h, i) => {
    const check = checkFourWords(h.w);
    if (!check.ok) errors.push(`${story.key} #${i + 1} "${h.w}": ${check.error}`);
    if (h.n && h.n.length > 140) errors.push(`${story.key} #${i + 1}: note over 140 characters`);
    if (h.d && h.d.length > 260) errors.push(`${story.key} #${i + 1}: diary entry is ${h.d.length} characters`);
    if (!h.d && i >= hops.length - STAMPED) errors.push(`${story.key} #${i + 1}: stamped hops need a diary entry`);
  });
  if (story.goal !== null && story.goal <= hops.length) errors.push(`${story.key}: goal ${story.goal} is already reached`);

  // Stories go wild about an hour apart, in file order, so the first four lead the home page.
  const billId = uuid();
  const wildSince = Math.round(NOW - order * 53 * MIN - (5 + rand() * 20) * MIN);
  const lastHop = Math.round(wildSince - (1 + rand() * 5) * HOUR);
  const created = Math.round(wildSince - story.spanDays * DAY);
  const firstHop = created + 4 * MIN;

  // A random walk, mostly American, never the same city twice in a row.
  // A test account signs about one hop in six, from its home city, never two in a row.
  const route: City[] = [];
  const writers: (TestUser | null)[] = [];
  hops.forEach((_, i) => {
    let writer: TestUser | null = null;
    if (i > 0 && TEST_USERS.length && rand() < 0.17) {
      const w = pick(TEST_USERS);
      if (writers[i - 1]?.email !== w.email) writer = w;
    }
    let city: City;
    if (i === 0 && story.origin) city = cityNamed(story.origin);
    else if (writer) city = cityNamed(writer.home);
    else {
      do city = rand() < 0.7 ? pick(CITIES.filter((c) => c[2] === "US")) : pick(CITIES.filter((c) => c[2] !== "US"));
      while (route[i - 1] && city[0] === route[i - 1][0]);
    }
    route.push(city);
    writers.push(writer);
  });
  const origin = route[0];

  sql.push(`-- ${story.key}: ${story.personality.name}`);
  sql.push(
    `INSERT INTO bills (id, seq, serial, status, theme, goal_hops, personality, origin_city, origin_lat, origin_lng, featured, is_seed, wild_since, version, created_at)
SELECT ${q(billId)}, s, ${q(SERIAL_PREFIX)} || '-' || printf('%04d', s), 'wild', ${q(story.theme)}, ${q(story.goal)}, ${q(JSON.stringify(story.personality))}, ${q(label(origin))}, ${origin[3]}, ${origin[4]}, 0, 1, ${wildSince}, 1, ${created}
FROM (SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM bills);`,
  );
  sql.push(
    `INSERT INTO diary (id, bill_id, hop_id, kind, day_label, text, ai_meta, created_at) VALUES (${q(uuid())}, ${q(billId)}, NULL, 'birth', ${q(`Day 1 — ${label(origin)}`)}, ${q(story.birth)}, ${q(AI_META)}, ${created + MIN});`,
  );

  const step = (lastHop - firstHop) / Math.max(1, hops.length - 1);
  let prev = firstHop;
  hops.forEach((h, i) => {
    const jitter = i === 0 || i === hops.length - 1 ? 0 : (rand() - 0.5) * step * 0.8;
    const t = Math.max(prev + 7 * MIN, Math.round(firstHop + step * i + jitter));
    prev = t;
    const [city, region, country, lat, lng] = route[i];
    const writer = writers[i];
    const stamped = i >= hops.length - STAMPED;
    const hopId = uuid();
    // An account that already exists links now; a new one's pid comes from the cron backfill.
    const pid = writer ? `(SELECT pid FROM users WHERE email = ${q(writer.email)})` : "NULL";
    sql.push(
      `INSERT INTO hops (id, bill_id, idx, status, words, content_words, note, pen_name, pen_verified, city, region, country, lat, lng, writer_email, writer_pid, stamp_status, diary_done, followers_notified, created_at, confirmed_at) VALUES (${[
        q(hopId), q(billId), i + 1, "'confirmed'", q(h.w), 4, q(h.n), q(writer?.handle), writer ? 1 : 0,
        q(city), q(region), q(country), lat, lng, q(writer?.email), pid, stamped ? "'pending'" : "'none'", stamped ? 0 : 1, 1, t, t,
      ].join(", ")});`,
    );
    if (h.d) {
      sql.push(
        `INSERT INTO diary (id, bill_id, hop_id, kind, day_label, text, ai_meta, created_at) VALUES (${q(`hop:${hopId}`)}, ${q(billId)}, ${q(hopId)}, 'hop', ${q(`Day ${Math.floor((t - created) / DAY) + 1} — ${label(route[i])}`)}, ${q(h.d)}, ${q(AI_META)}, ${t + 90_000});`,
      );
    }
  });
  sql.push(
    `UPDATE bills SET hop_count = (SELECT COUNT(*) FROM hops WHERE bill_id = ${q(billId)} AND status = 'confirmed'), word_count = (SELECT COALESCE(SUM(content_words), 0) FROM hops WHERE bill_id = ${q(billId)} AND status = 'confirmed') WHERE id = ${q(billId)};`,
  );
  const signers = writers.filter((w) => w !== null).map((w) => w.handle);
  summary.push(`${story.key.padEnd(11)} ${String(hops.length).padStart(3)} hops  ${story.personality.name.padEnd(26)} from ${label(origin)}${signers.length ? `  signed by ${signers.join(", ")}` : ""}`);
});

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

// The account takes the participant id cron computed for its hops. Existing accounts are left alone.
const users = TEST_USERS.map(
  (u) =>
    `INSERT OR IGNORE INTO users (id, email, pid, handle, first_name, last_name, is_admin, created_at)
SELECT ${q(uuid())}, ${q(u.email)}, writer_pid, ${q(u.handle)}, 'Ammon', 'Test', 0, ${Date.now()} FROM hops WHERE writer_email = ${q(u.email)} AND writer_pid IS NOT NULL LIMIT 1;`,
);

const out = new URL("../../output/seed-wild/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("seed.sql", out), sql.join("\n") + "\n");
writeFileSync(new URL("users.sql", out), users.join("\n") + "\n");
console.log(summary.join("\n"));
console.log(`\n${STORIES.reduce((n, s) => n + s.hops.length, 0)} hops in ${STORIES.length} stories. Wrote output/seed-wild/seed.sql and users.sql.`);
