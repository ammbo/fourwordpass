import { useEffect } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { BillPage } from "./pages/Bill";
import { Home } from "./pages/Home";
import { FollowManage, NotFound, Release, Wild } from "./pages/Other";

function ScrollToTop() {
  const [path] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return null;
}

export function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-12 shrink-0 place-items-center rounded-md border-2 border-ink bg-bill font-display text-base font-bold italic text-ink">4</span>
            <span className="whitespace-nowrap font-display text-base font-semibold tracking-tight sm:text-lg">Four Word Pass</span>
          </Link>
          <div className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold sm:gap-2">
            <Link href="/wild" className="rounded-full px-2.5 py-2 hover:bg-paper-2 sm:px-3">
              <span className="sm:hidden">Wild</span>
              <span className="hidden sm:inline">The wild</span>
            </Link>
            <Link href="/release" className="btn btn-primary !px-4 !py-2 text-sm">
              <span className="sm:hidden">Release</span>
              <span className="hidden sm:inline">Release a buck</span>
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/release" component={Release} />
          <Route path="/wild" component={Wild} />
          <Route path="/b/:serial" component={BillPage} />
          <Route path="/f/:id" component={FollowManage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:justify-between">
          <div>
            <span className="font-display font-semibold text-ink">Four Word Pass</span> <span className="italic">(say it out loud)</span> · Pay it forword.
          </div>
          <div>Every hop is a real PayPal payout (sandbox during the beta). Stories are written by people; the bill only narrates.</div>
        </div>
      </footer>
    </div>
  );
}
