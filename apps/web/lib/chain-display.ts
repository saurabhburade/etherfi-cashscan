import { CHAIN_IDS } from "@etherfi/contracts";
import { tokenAssetIconUrl } from "@/lib/token-icons";

const SCROLL_NATIVE_TOKEN_ADDRESS = "0xd29687c813d741e2f938f4ac377128810e217b1b";

export type ChainBadgeAppearance = {
  className: string;
  iconUrl?: string | null;
  label: string;
};

export const CHAIN_BADGE_APPEARANCE_BY_ID: Readonly<Partial<Record<number, ChainBadgeAppearance>>> = {
  [CHAIN_IDS.optimism]: { label: "OP", className: "bg-[#ff0420] text-white" },
  [CHAIN_IDS.scroll]: {
    label: "SCR",
    className: "bg-[#ffeeda] text-[#191919]",
    iconUrl: tokenAssetIconUrl(CHAIN_IDS.scroll, SCROLL_NATIVE_TOKEN_ADDRESS),
  },
};

export const DEFAULT_CHAIN_BADGE_APPEARANCE: ChainBadgeAppearance = {
  label: "•",
  className: "bg-zinc-700 text-white",
};
