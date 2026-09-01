import { type NextRequest, NextResponse } from "next/server";
import { loadActivityPage } from "@/lib/envio";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chainId = Number(params.get("chainId") ?? 0);
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 10);

  try {
    const result = await loadActivityPage({
      query: params.get("query") ?? undefined,
      chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : undefined,
      eventType: params.get("eventType") ?? undefined,
      page: Number.isInteger(page) ? page : 1,
      pageSize: Number.isInteger(pageSize) ? pageSize : 10,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load transactions" },
      { status: 502 },
    );
  }
}
