"use client";

import { CircleQuestionMark } from "lucide-react";
import { useEffect, useState } from "react";
import { tokenAssetIconUrls } from "@/lib/token-icons";
import { cn } from "@/lib/utils";

type TokenIconProps = {
  address: string;
  chainId: number;
  className?: string;
  symbol?: string;
};

export function TokenIcon({ address, chainId, className, symbol }: TokenIconProps) {
  const sources = tokenAssetIconUrls(chainId, address, symbol);
  const sourcesKey = sources.join("|");
  const [sourceState, setSourceState] = useState({ index: 0, key: sourcesKey });
  const [isHydrated, setIsHydrated] = useState(false);
  const sourceIndex = sourceState.key === sourcesKey ? sourceState.index : 0;
  const source = sources[sourceIndex] ?? null;
  const label = symbol || "Unknown";

  useEffect(() => setIsHydrated(true), []);

  return (
    <span
      aria-label={`${label} token`}
      className={cn(
        "relative inline-grid size-6 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary text-[9px] font-semibold uppercase text-muted-foreground dark:bg-zinc-800 dark:text-zinc-400",
        className,
      )}
      role="img"
    >
      {isHydrated && source ? (
        // Trust Wallet (Scroll) and SmolDapp are dynamic address-indexed sources.
        // A native image lets us advance to the next source when an asset is absent.
        // biome-ignore lint/performance/noImgElement: native image error handling advances through dynamic fallback URLs
        <img
          alt=""
          className="size-full object-cover"
          key={source}
          loading="eager"
          onError={(event) => {
            event.currentTarget.hidden = true;
            setSourceState({ index: sourceIndex + 1, key: sourcesKey });
          }}
          referrerPolicy="no-referrer"
          src={source}
        />
      ) : (
        <CircleQuestionMark aria-hidden="true" className="h-1/2 w-1/2" />
      )}
    </span>
  );
}
