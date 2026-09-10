"use client";

import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const VIEW_TRANSITION_STYLE_ID = "beui-theme-toggle-view-transition";
const VIEW_TRANSITION_CSS = `
  html[data-beui-vt="circle-blur"]::view-transition-old(root) {
    animation: none;
    mix-blend-mode: normal;
  }

  html[data-beui-vt="circle-blur"]::view-transition-new(root) {
    mix-blend-mode: normal;
    animation: beui-circle-blur-reveal 700ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  @keyframes beui-circle-blur-reveal {
    from {
      clip-path: circle(0% at var(--beui-vt-origin, 100% 0%));
      filter: blur(8px);
    }
    to {
      clip-path: circle(150% at var(--beui-vt-origin, 100% 0%));
      filter: blur(0px);
    }
  }
`;

type ViewTransitionDocument = Document & {
  startViewTransition(callback: () => void): { finished: Promise<void> };
};

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion() ?? false;
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (document.getElementById(VIEW_TRANSITION_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = VIEW_TRANSITION_STYLE_ID;
    style.textContent = VIEW_TRANSITION_CSS;
    document.head.appendChild(style);
  }, []);

  const dark = resolvedTheme === "dark";

  function toggleTheme() {
    const nextTheme = dark ? "light" : "dark";

    if (reduceMotion || !("startViewTransition" in document)) {
      setTheme(nextTheme);
      return;
    }

    const root = document.documentElement;
    root.style.setProperty("--beui-vt-origin", "100% 0%");
    root.dataset.beuiVt = "circle-blur";

    const transition = (document as ViewTransitionDocument).startViewTransition(() => setTheme(nextTheme));
    transition.finished.finally(() => {
      delete root.dataset.beuiVt;
      root.style.removeProperty("--beui-vt-origin");
    });
  }

  return (
    <Button
      aria-label={mounted ? `Switch to ${dark ? "light" : "dark"} theme` : "Toggle theme"}
      className="size-8 rounded-full border-border bg-secondary text-muted-foreground transition-[color,background-color,border-color,transform] hover:bg-secondary/70 hover:text-foreground active:scale-[0.96] active:bg-secondary dark:bg-secondary dark:hover:bg-secondary/70 dark:active:bg-secondary"
      disabled={!mounted}
      onClick={toggleTheme}
      size="icon"
      type="button"
      variant="outline"
    >
      {mounted ? (
        <span className="relative inline-grid size-4 shrink-0 place-items-center overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              className="col-start-1 row-start-1 inline-flex items-center justify-center will-change-[opacity,filter,transform]"
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              key={dark ? "dark" : "light"}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            >
              {dark ? (
                <Sun aria-hidden="true" className="size-4" strokeWidth={2.25} />
              ) : (
                <Moon aria-hidden="true" className="size-4" strokeWidth={2.25} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      ) : (
        <span aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}
