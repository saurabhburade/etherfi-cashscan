import { type NextRequest, NextResponse } from "next/server";
import { type AccountAnalyticsSort, loadAccountAnalyticsPage } from "@/lib/account-analytics";

export const runtime = "edge";

const sorts = new Set<AccountAnalyticsSort>(["balance", "netWorth", "spend", "deposits", "transactions", "recent"]);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chainId = Number(params.get("chainId") ?? 0);
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 10);
  const requestedSort = params.get("sort") as AccountAnalyticsSort | null;

  try {
    const result = await loadAccountAnalyticsPage({
      query: params.get("query") ?? undefined,
      chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : undefined,
      sort: requestedSort && sorts.has(requestedSort) ? requestedSort : "balance",
      page: Number.isInteger(page) ? page : 1,
      pageSize: Number.isInteger(pageSize) ? pageSize : 10,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load accounts" },
      { status: 502 },
    );
  }
}
