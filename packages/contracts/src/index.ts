export type ChainDefinition = {
  id: number;
  name: string;
  explorer: string;
  role: "cash" | "source" | "legacy";
};

export type ContractDefinition = {
  chainId: number;
  name: string;
  address: `0x${string}`;
  purpose: string;
};

export const CHAIN_IDS = {
  ethereum: 1,
  optimism: 10,
  bnb: 56,
  hyperEvm: 999,
  base: 8453,
  arbitrum: 42161,
  scroll: 534352,
} as const;

export const CHAINS: readonly ChainDefinition[] = [
  { id: CHAIN_IDS.ethereum, name: "Ethereum", explorer: "https://etherscan.io", role: "source" },
  { id: CHAIN_IDS.optimism, name: "Optimism", explorer: "https://optimistic.etherscan.io", role: "cash" },
  { id: CHAIN_IDS.bnb, name: "BNB Chain", explorer: "https://bscscan.com", role: "source" },
  { id: CHAIN_IDS.base, name: "Base", explorer: "https://basescan.org", role: "source" },
  { id: CHAIN_IDS.arbitrum, name: "Arbitrum", explorer: "https://arbiscan.io", role: "source" },
  { id: CHAIN_IDS.scroll, name: "Scroll", explorer: "https://scrollscan.com", role: "legacy" },
  { id: CHAIN_IDS.hyperEvm, name: "HyperEVM", explorer: "https://hyperevmscan.io", role: "source" },
] as const;

// The contract registry is broader than the active destination-ledger indexer.
// UI coverage and filters must use this subset rather than implying every
// registered source chain is currently indexed.
export const INDEXED_CHAINS = CHAINS.filter(
  (chain) => chain.id === CHAIN_IDS.optimism || chain.id === CHAIN_IDS.scroll,
);

const contract = (chainId: number, name: string, address: `0x${string}`, purpose: string): ContractDefinition => ({
  chainId,
  name,
  address: address.toLowerCase() as `0x${string}`,
  purpose,
});

export const CONTRACTS: readonly ContractDefinition[] = [
  contract(
    CHAIN_IDS.optimism,
    "CashEventEmitter",
    "0x380B2e96799405be6e3D965f4044099891881acB",
    "Card spend, repayment, cashback and withdrawal lifecycle",
  ),
  contract(
    CHAIN_IDS.optimism,
    "DebtManager",
    "0x0078C5a459132e279056B2371fE8A8eC973A9553",
    "Current supply, borrow and repay activity",
  ),
  contract(
    CHAIN_IDS.optimism,
    "DebtManagerLegacy",
    "0x8f9d2Cd33551CE06dD0564Ba147513F715c2F4a0",
    "Historical debt activity after the Scroll migration",
  ),
  contract(
    CHAIN_IDS.optimism,
    "EtherFiSafeFactory",
    "0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF",
    "Cash safe discovery",
  ),
  contract(
    CHAIN_IDS.optimism,
    "TopUpDest",
    "0x3a6A724595184dda4be69dB1Ce726F2Ac3D66B87",
    "Canonical completed cross-chain top-ups",
  ),
  contract(
    CHAIN_IDS.optimism,
    "RampVolumeEmitter",
    "0xaBFB1aA2B401248242d98ba8de0BE1c81f8b699c",
    "Daily ramp volume snapshots",
  ),
  contract(
    CHAIN_IDS.optimism,
    "EUR/USD Chainlink aggregator",
    "0x3b9C20928f913645eE1E56aaa8bF399367Fb4dCB",
    "AnswerUpdated history behind the EUR/USD proxy",
  ),
  contract(
    CHAIN_IDS.scroll,
    "UserSafeFactory",
    "0x18Fa07dF94b4E9F09844e1128483801B24Fe8a27",
    "Legacy Cash safe discovery",
  ),
  contract(
    CHAIN_IDS.scroll,
    "UserSafeEventEmitter",
    "0x5423885B376eBb4e6104b8Ab1A908D350F6A162e",
    "Legacy spend and repayment activity",
  ),
  contract(
    CHAIN_IDS.scroll,
    "CashEventEmitter",
    "0x380B2e96799405be6e3D965f4044099891881acB",
    "Current Cash v3 event surface on Scroll",
  ),
  contract(
    CHAIN_IDS.scroll,
    "DebtManager",
    "0x0078C5a459132e279056B2371fE8A8eC973A9553",
    "Current supply, borrow, repay, liquidation and interest-index activity",
  ),
  contract(
    CHAIN_IDS.scroll,
    "EtherFiSafeFactory",
    "0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF",
    "Current Cash v3 safe discovery on Scroll",
  ),
  contract(
    CHAIN_IDS.scroll,
    "TopUpDest",
    "0x3a6A724595184dda4be69dB1Ce726F2Ac3D66B87",
    "Current destination top-ups on Scroll",
  ),
  contract(
    CHAIN_IDS.scroll,
    "LegacyTopUpDest",
    "0xeb61c16A60ab1b4a9a1F8E92305808F949F4Ea9B",
    "Original Scroll top-up destination and batch events",
  ),
  ...[CHAIN_IDS.ethereum, CHAIN_IDS.bnb, CHAIN_IDS.base, CHAIN_IDS.arbitrum, CHAIN_IDS.hyperEvm].map((chainId) =>
    contract(
      chainId,
      "TopUpFactory",
      "0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF",
      "Top-up account discovery, redirect and bridge activity",
    ),
  ),
  ...[CHAIN_IDS.ethereum, CHAIN_IDS.bnb, CHAIN_IDS.base, CHAIN_IDS.arbitrum, CHAIN_IDS.hyperEvm].map((chainId) =>
    contract(
      chainId,
      "TradingSafeFactory",
      "0xE54e00b0e72F8FC8Cb7e124C378bAd2E7371d2b8",
      "Trading-safe to top-up mapping",
    ),
  ),
] as const;

export const CHAIN_BY_ID = new Map(CHAINS.map((chain) => [chain.id, chain]));
export const INDEXED_CHAIN_BY_ID = new Map(INDEXED_CHAINS.map((chain) => [chain.id, chain]));
export const CONTRACT_BY_KEY = new Map(CONTRACTS.map((item) => [`${item.chainId}:${item.name}`, item]));

export function explorerAddressUrl(chainId: number, address: string) {
  const explorer = CHAIN_BY_ID.get(chainId)?.explorer;
  return explorer ? `${explorer}/address/${address}` : undefined;
}
