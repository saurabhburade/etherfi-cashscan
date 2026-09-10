import { type ReactNode, Suspense } from "react";
import type { DashboardRoute } from "@/components/dashboard-routes";
import type { ExplorerData } from "@/lib/envio";

export type { DashboardRoute } from "@/components/dashboard-routes";

type DashboardShellProps = {
  data?: ExplorerData;
  dataPromise?: Promise<ExplorerData>;
  active: DashboardRoute;
  children: ReactNode;
};

export function DashboardShell({ children, data, dataPromise }: DashboardShellProps) {
  return (
    <>
      {dataPromise ? (
        <Suspense fallback={null}>
          <DeferredDataNotice dataPromise={dataPromise} />
        </Suspense>
      ) : data && data.mode !== "live" ? (
        <DataNotice data={data} />
      ) : null}
      <div className="mx-auto w-full max-w-[1540px] px-8 sm:px-12 lg:px-24 xl:px-32">{children}</div>
    </>
  );
}

async function DeferredDataNotice({ dataPromise }: { dataPromise: Promise<ExplorerData> }) {
  const data = await dataPromise;
  return data.mode !== "live" ? <DataNotice data={data} /> : null;
}

function DataNotice({ data }: { data: ExplorerData }) {
  const copy =
    data.mode === "empty"
      ? ["Connected.", "No activity available yet."]
      : ["Live source unavailable.", "No fixture data is shown."];
  return (
    <div className="mx-auto mt-4 w-full max-w-[1540px] px-8 sm:px-12 lg:px-24 xl:px-32">
      <div className="flex justify-between rounded-2xl border border-amber-400/15 bg-amber-400/[.06] px-4 py-3 text-xs text-amber-200">
        <span>
          <strong>{copy[0]}</strong> {copy[1]}
          {data.errorMessage ? ` ${data.errorMessage}` : ""}
        </span>
      </div>
    </div>
  );
}
