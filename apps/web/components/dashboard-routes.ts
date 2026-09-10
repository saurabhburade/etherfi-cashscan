export const dashboardRoutes = [
  { id: "overview", href: "/", label: "Overview" },
  { id: "stats", href: "/stats", label: "Stats" },
  { id: "transactions", href: "/transactions", label: "Transactions" },
  { id: "accounts", href: "/accounts", label: "Accounts" },
  { id: "tokens", href: "/tokens", label: "Tokens" },
] as const;

export type DashboardRoute = (typeof dashboardRoutes)[number]["id"];
