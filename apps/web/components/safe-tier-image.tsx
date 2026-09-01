"use client";

import { WalletCards } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { safeTierImageUrl, safeTierName } from "@/lib/safe-tier";
import { cn } from "@/lib/utils";

export function SafeTierImage({ tierId, className }: { tierId: number | null; className?: string }) {
  const tierUrl = safeTierImageUrl(tierId);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === tierUrl;

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-secondary",
        className,
      )}
      title={`${safeTierName(tierId)} tier`}
    >
      {failed ? (
        <WalletCards aria-hidden="true" className="size-1/2 text-muted-foreground" />
      ) : (
        <Image alt="" className="object-cover" fill onError={() => setFailedUrl(tierUrl)} sizes="56px" src={tierUrl} />
      )}
    </span>
  );
}
