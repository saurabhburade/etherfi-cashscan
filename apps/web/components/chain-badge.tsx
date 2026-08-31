import { INDEXED_CHAIN_BY_ID } from "@etherfi/contracts";
import { CHAIN_BADGE_APPEARANCE_BY_ID, DEFAULT_CHAIN_BADGE_APPEARANCE } from "@/lib/chain-display";
import { cn } from "@/lib/utils";

export function ChainBadge({ chainId, className }: { chainId: number; className?: string }) {
  const chain = INDEXED_CHAIN_BY_ID.get(chainId);
  const appearance = CHAIN_BADGE_APPEARANCE_BY_ID[chainId] ?? DEFAULT_CHAIN_BADGE_APPEARANCE;

  return (
    <span
      aria-label={chain ? `${chain.name} network` : `Chain ${chainId}`}
      className={cn(
        "inline-grid size-4 place-items-center overflow-hidden rounded-full border border-border text-[6px] font-bold leading-none shadow-[0_1px_3px_rgba(0,0,0,.18)] ring-2 ring-card dark:shadow-[0_1px_5px_rgba(0,0,0,.55)]",
        appearance.className,
        className,
      )}
      role="img"
      title={chain?.name ?? `Chain ${chainId}`}
    >
      {appearance.iconUrl ? (
        // The Scroll network badge uses the native SCR token artwork.
        // biome-ignore lint/performance/noImgElement: the badge uses a small external token asset
        <img alt="" className="size-full object-cover" src={appearance.iconUrl} />
      ) : (
        appearance.label
      )}
    </span>
  );
}
