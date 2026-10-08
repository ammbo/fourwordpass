import { Link } from "wouter";
import type { BillSummary } from "../../shared/types";
import { STATUS_LABEL, STATUS_TONE, timeAgo } from "../lib";
import { Banknote } from "./Banknote";

export function BillCard({ bill, action }: { bill: BillSummary; action?: React.ReactNode }) {
  return (
    <div className="card group flex flex-col p-3.5 transition hover:-translate-y-0.5 hover:shadow-xl">
      <Link href={`/b/${bill.serial}`} className="block">
        <Banknote serial={bill.serial} persona={bill.personaName} hops={bill.hopCount} muted={bill.status === "eulogized"} />
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className={`chip ${STATUS_TONE[bill.status]}`}>{STATUS_LABEL[bill.status]}</span>
          <span className="text-xs text-muted">{bill.lastPlace ?? bill.originCity ?? "Somewhere"}</span>
        </div>
        <p className="mt-2 line-clamp-2 min-h-[3.2em] font-display text-[1.02rem] leading-snug text-ink/90">
          {bill.teaser ? `“…${bill.teaser}”` : <span className="italic text-muted">Waiting for its first words.</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 font-mono text-[0.68rem] uppercase tracking-wider text-muted">
          <span>{bill.hopCount} hops</span>
          <span>{bill.wordCount} words</span>
          <span>{bill.followerCount} watching</span>
          <span>{timeAgo(bill.createdAt)}</span>
          {bill.isSeed && <span className="text-gold">demo</span>}
        </div>
      </Link>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
