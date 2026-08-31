import { CHAIN_IDS } from "@etherfi/contracts";
import { getAddress, isAddress } from "viem";

const SMOL_TOKEN_ASSET_ROOT = "https://raw.githubusercontent.com/SmolDapp/tokenAssets/main/tokens";
const SUSHI_TOKEN_ASSET_ROOT = "https://cdn.sushi.com/tokens";
const TRUST_WALLET_ASSET_ROOT = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

type TokenLogoProvider = (address: string) => string[];

function smolDappLogoUrls(chainId: number, address: string) {
  return [`${SMOL_TOKEN_ASSET_ROOT}/${chainId}/${address}/logo.svg`];
}

const TOKEN_LOGO_PROVIDER_BY_CHAIN_ID: Readonly<Partial<Record<number, TokenLogoProvider>>> = {
  [CHAIN_IDS.optimism]: (address) => [
    `${SUSHI_TOKEN_ASSET_ROOT}/${CHAIN_IDS.optimism}/${address}.jpg`,
    ...smolDappLogoUrls(CHAIN_IDS.optimism, address),
  ],
  [CHAIN_IDS.scroll]: (address) => [
    `${TRUST_WALLET_ASSET_ROOT}/scroll/assets/${getAddress(address)}/logo.png`,
    ...smolDappLogoUrls(CHAIN_IDS.scroll, address),
  ],
};

export function tokenAssetIconUrls(chainId: number, address: string): string[] {
  const normalizedAddress = address.toLowerCase();
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !isAddress(normalizedAddress)) return [];

  const provider = TOKEN_LOGO_PROVIDER_BY_CHAIN_ID[chainId];
  return provider ? provider(normalizedAddress) : smolDappLogoUrls(chainId, normalizedAddress);
}

export function tokenAssetIconUrl(chainId: number, address: string): string | null {
  return tokenAssetIconUrls(chainId, address)[0] ?? null;
}
