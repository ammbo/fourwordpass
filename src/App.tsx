import { Suspense, lazy, useEffect } from "react";
import { Link, Route, Switch, useLocation, useParams } from "wouter";
import { BillPage } from "./pages/Bill";
import { Home } from "./pages/Home";
import { FollowManage, NotFound, Release, Wild } from "./pages/Other";
import { PageMetadata } from "./components/PageMetadata";
import { Info } from "./pages/Info";
import { PaymentProvider, usePaymentMode } from "./paymentMode";
import { paymentNotice } from "../shared/payments";
import { INFO_LINKS } from "../shared/info";

// The grid and chart libraries only load for Open Books.
const Books = lazy(() => import("./pages/Books").then((m) => ({ default: m.Books })));
const BooksRoute = () => (
  <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-16"><div className="h-40 animate-pulse-soft rounded-2xl bg-paper-2" /></div>}>
    <Books />
  </Suspense>
);

function ScrollToTop() {
  const [path] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return null;
}

function BillRoute() {
  const {serial} = useParams<{serial: string}>();
  return <BillPage key={serial.toUpperCase()} />;
}

function FollowRoute() {
  const {id} = useParams<{id: string}>();
  return <FollowManage key={id} />;
}

export function App() {
  return <PaymentProvider><AppContents /></PaymentProvider>;
}

function AppContents() {
  const mode = usePaymentMode();
  return (
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <PageMetadata />
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Four Word Pass home">
            <img src="/logo.svg" width="48" height="36" alt="" className="h-9 w-12 shrink-0" />
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
          <Route path="/books" component={BooksRoute} />
          <Route path="/b/:serial" component={BillRoute} />
          <Route path="/f/:id" component={FollowRoute} />
          {INFO_LINKS.map(({ path }) => <Route key={path} path={path} component={Info} />)}
          <Route component={NotFound} />
        </Switch>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-8 text-sm text-muted">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <div>
              <span className="font-display font-semibold text-ink">Four Word Pass</span> <span className="italic">(say it out loud)</span> · Pay it forword.
            </div>
            <div className="max-w-lg">{paymentNotice(mode)} People write the story; AI gives the bill its diary, stamps, and eulogy.</div>
          </div>
          <nav aria-label="Information" className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link href="/books" className="font-semibold text-ink underline-offset-4 hover:underline">Open books</Link>
            {INFO_LINKS.map(({ path, label }) => <Link key={path} href={path} className="underline-offset-4 hover:text-ink hover:underline">{label}</Link>)}
          </nav>
        </div>
      </footer>
    </div>
  );
}
