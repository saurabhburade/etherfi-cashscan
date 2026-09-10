"use client";

import { LayoutGroup, motion, type Transition, useReducedMotion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type MouseEvent, useEffect, useId, useState } from "react";
import { type DashboardRoute, dashboardRoutes } from "@/components/dashboard-routes";

const navIndicatorTransition: Transition = {
  type: "spring",
  stiffness: 170,
  damping: 24,
  mass: 1.2,
};

export function DashboardNavigation({ className, compact = false }: { className: string; compact?: boolean }) {
  const pathname = usePathname();
  const active = getActiveRoute(pathname);
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  const [selected, setSelected] = useState(active);

  useEffect(() => setSelected(active), [active]);

  function selectItem(event: MouseEvent<HTMLAnchorElement>, id: DashboardRoute) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    setSelected(id);
  }

  return (
    <LayoutGroup id={groupId}>
      <nav aria-label="Dashboard" className={`relative isolate ${className}`}>
        {dashboardRoutes.map((item) => {
          const isActive = selected === item.id;

          return (
            <Link
              aria-current={active === item.id ? "page" : undefined}
              className={`relative whitespace-nowrap rounded-full px-3 py-1.5 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${compact ? "text-xs" : "text-sm"} ${isActive ? "text-foreground" : "text-muted-foreground"}`}
              href={item.href}
              key={item.href}
              onClick={(event) => selectItem(event, item.id)}
            >
              {isActive ? (
                <motion.span
                  className="absolute inset-0 z-0 rounded-full bg-muted"
                  data-dashboard-nav-indicator=""
                  initial={false}
                  layoutId="dashboard-nav-indicator"
                  transition={reduceMotion ? { duration: 0 } : navIndicatorTransition}
                />
              ) : null}
              <span className="relative z-10">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

function getActiveRoute(pathname: string): DashboardRoute | null {
  return (
    dashboardRoutes.find((item) =>
      item.href === "/" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`),
    )?.id ?? null
  );
}
