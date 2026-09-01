import { type NextRequest, NextResponse } from "next/server";
import { loadActivityPage } from "@/lib/envio";

export const runtime = "edge";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const chainId = Number(params.get("chainId") ?? 0);
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("pageSize") ?? 10);
  const tokenScopes = parseTokenScopes(params.get("tokenScopes"));

  try {
    const result = await loadActivityPage({
      query: params.get("query") ?? undefined,
      account: params.get("account") ?? undefined,
      token: params.get("token") ?? undefined,
      tokenScopes,
      chainId: Number.isInteger(chainId) && chainId > 0 ? chainId : undefined,
      eventType: params.get("eventType") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      page: Number.isInteger(page) ? page : 1,
      pageSize: Number.isInteger(pageSize) ? pageSize : 10,
      legacyOnly: params.get("legacyOnly") === "true",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load transactions" },
      { status: 502 },
    );
  }
}

function parseTokenScopes(value: string | null) {
  if (!value) return undefined;
  const scopes = value.split(",").flatMap((entry) => {
    const [chain, token] = entry.split(":");
    const chainId = Number(chain);
    if (!token || !Number.isInteger(chainId) || chainId <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(token)) return [];
    return [{ chainId, token: token.toLowerCase() }];
  });
  return scopes.length ? scopes : undefined;
}
