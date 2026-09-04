"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function DashboardNavLink({
  children,
  compact = false,
  href,
}: {
  children: ReactNode;
  compact?: boolean;
  href: string;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

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
