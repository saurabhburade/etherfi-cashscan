import Image from "next/image";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ExplorerData } from "@/lib/envio";

const navigation = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "stats", href: "/stats", label: "Stats" },
  { id: "transactions", href: "/transactions", label: "Transactions" },
] as const;

export type DashboardRoute = (typeof navigation)[number]["id"];

type DashboardShellProps = {
  data?: ExplorerData;
  dataPromise?: Promise<ExplorerData>;
  active: DashboardRoute;
  children: ReactNode;
};

export function DashboardShell({ active, children, data, dataPromise }: DashboardShellProps) {
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/92 backdrop-blur-xl">
        <div className="mx-auto flex h-[74px] w-full max-w-[1540px] items-center gap-4 px-8 sm:px-12 lg:px-24 xl:px-32">
          <Link
            aria-label="Ether.fi Cashscan dashboard"
            className="flex shrink-0 items-center gap-2 text-foreground"
            href="/"
          >
            <Image
              alt="Ether.fi"
              className="size-6 rounded-[7px]"
              height={28}
              priority
              src="/brand/etherfi-app-icon.svg"
              width={28}
            />
            <span className="text-sm font-semibold">Cashscan</span>
          </Link>
          <nav
            aria-label="Dashboard"
            className="hidden min-w-0 items-center gap-5 overflow-x-auto text-sm font-medium text-muted-foreground lg:flex"
          >
            {navigation.map((item) => (
              <NavLink active={item.id === active} href={item.href} key={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
        <nav
          aria-label="Dashboard"
          className="mx-auto flex w-full max-w-[1540px] gap-1 overflow-x-auto border-t border-border px-8 py-2 sm:px-12 lg:hidden"
        >
          {navigation.map((item) => (
            <NavLink active={item.id === active} compact href={item.href} key={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      {dataPromise ? (
        <Suspense fallback={null}>
          <DeferredDataNotice dataPromise={dataPromise} />
        </Suspense>
      ) : data && data.mode !== "live" ? (
        <DataNotice data={data} />
      ) : null}
      <div className="mx-auto w-full max-w-[1540px] px-8 sm:px-12 lg:px-24 xl:px-32">{children}</div>
      <footer className="mt-16 border-y border-border">
        <div className="mx-auto flex w-full max-w-[1540px] items-center justify-between gap-4 px-8 py-6 text-xs text-muted-foreground sm:px-12 lg:px-24 xl:px-32">
          <span>ether.fi Cash Explorer</span>
          <div className="flex items-center gap-2">
            <FooterSocialLink href="https://github.com/etherfi-protocol/cash-v3" label="Ether.fi Cash on GitHub">
              <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.69c-2.78.61-3.37-1.2-3.37-1.2-.45-1.16-1.11-1.47-1.11-1.47-.91-.63.07-.62.07-.62 1 .08 1.54 1.04 1.54 1.04.9 1.55 2.35 1.1 2.92.84.09-.66.35-1.1.64-1.36-2.22-.26-4.56-1.12-4.56-4.95 0-1.1.39-1.99 1.03-2.69-.1-.26-.45-1.29.1-2.65 0 0 .84-.27 2.75 1.03A9.4 9.4 0 0 1 12 6.95a9.4 9.4 0 0 1 2.5.34c1.91-1.3 2.75-1.03 2.75-1.03.55 1.36.2 2.39.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.69-4.57 4.94.36.32.68.94.68 1.9v2.57c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" />
              </svg>
            </FooterSocialLink>
            <FooterSocialLink href="https://x.com/ether_fi" label="Ether.fi on X">
              <svg aria-hidden="true" fill="currentColor" viewBox="0 0 16 16">
                <path d="M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z" />
              </svg>
            </FooterSocialLink>
          </div>
        </div>
      </footer>
    </div>
  );
}

async function DeferredDataNotice({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  const data = await dataPromise;
  return data.mode !== "live" ? <DataNotice data={data} /> : null;
}

function FooterSocialLink({ children, href, label }: { children: ReactNode; href: string; label: string }) {
  return (
    <a
      aria-label={label}
      className="grid size-8 place-items-center rounded-full border border-border bg-secondary/40 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&>svg]:size-4"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );
}

function NavLink({
  active,
  children,
  compact = false,
  href,
}: {
  active: boolean;
  children: ReactNode;
  compact?: boolean;
  href: (typeof navigation)[number]["href"];
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`whitespace-nowrap rounded-full px-3 py-1.5 transition-colors hover:text-foreground ${compact ? "text-xs" : "text-sm"} ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}
      href={href}
    >
      {children}
    </Link>
  );
}

function DataNotice({ data }: { data: ExplorerData }) {
  const copy =
    data.mode === "empty"
      ? ["Indexer connected.", "No entities have been indexed yet."]
      : ["Live source unavailable.", "No fixture data is shown."];
  return (
    <div className="mx-auto mt-4 flex w-[calc(100%-2rem)] max-w-[1510px] justify-between rounded-2xl border border-amber-400/15 bg-amber-400/[.06] px-4 py-3 text-xs text-amber-200">
      <span>
        <strong>{copy[0]}</strong> {copy[1]}
        {data.errorMessage ? ` ${data.errorMessage}` : ""}
      </span>
    </div>
  );
}
