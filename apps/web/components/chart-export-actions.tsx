"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Check, Copy, Download, Share2, TriangleAlert, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  type ChartExportAspect,
  copyChartJpeg,
  copyChartJpegFromElement,
  downloadChartJpeg,
  renderChartJpeg,
} from "@/lib/chart-svg-export";
import { cn } from "@/lib/utils";

type ExportFeedback = "copied" | "copy-error" | "download-error" | "preview-error" | null;

export interface ChartExportActionsProps {
  containerRef: RefObject<HTMLElement | null>;
  filename: string;
  title: string;
  value: string;
}

export function ChartExportActions({ containerRef, filename, title, value }: ChartExportActionsProps) {
  const [feedback, setFeedback] = useState<ExportFeedback>(null);
  const [open, setOpen] = useState(false);
  const [aspect, setAspect] = useState<ChartExportAspect>("default");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const feedbackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewBlob = useRef<Blob | null>(null);
  const previewObjectUrl = useRef<string | null>(null);
  const previewRequest = useRef(0);

  useEffect(
    () => () => {
      if (feedbackTimeout.current !== null) clearTimeout(feedbackTimeout.current);
      if (previewObjectUrl.current) URL.revokeObjectURL(previewObjectUrl.current);
    },
    [],
  );

  function showFeedback(nextFeedback: Exclude<ExportFeedback, null>) {
    if (feedbackTimeout.current !== null) clearTimeout(feedbackTimeout.current);
    setFeedback(nextFeedback);
    feedbackTimeout.current = setTimeout(() => setFeedback(null), 1_800);
  }

  async function preparePreview(nextAspect: ChartExportAspect) {
    const requestId = ++previewRequest.current;
    setFeedback(null);
    setPreviewLoading(true);
    setPreviewUrl(null);
    previewBlob.current = null;
    if (previewObjectUrl.current) {
      URL.revokeObjectURL(previewObjectUrl.current);
      previewObjectUrl.current = null;
    }
    const container = containerRef.current;
    if (!container) {
      setPreviewLoading(false);
      showFeedback("preview-error");
      return;
    }

    try {
      const blob = await renderChartJpeg(container, { aspect: nextAspect, title, value });
      if (requestId !== previewRequest.current) return;
      const objectUrl = URL.createObjectURL(blob);
      previewBlob.current = blob;
      previewObjectUrl.current = objectUrl;
      setPreviewUrl(objectUrl);
    } catch {
      if (requestId === previewRequest.current) showFeedback("preview-error");
    } finally {
      if (requestId === previewRequest.current) setPreviewLoading(false);
    }
  }

  function handleAspectChange(nextAspect: ChartExportAspect) {
    setAspect(nextAspect);
    void preparePreview(nextAspect);
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) void preparePreview(aspect);
  }

  async function handleCopy() {
    const container = containerRef.current;
    if (!container) {
      showFeedback("copy-error");
      return;
    }

    try {
      if (previewBlob.current) {
        await copyChartJpeg(previewBlob.current);
      } else {
        await copyChartJpegFromElement(container, { aspect, title, value });
      }
      showFeedback("copied");
    } catch {
      showFeedback("copy-error");
    }
  }

  async function handleDownload() {
    const container = containerRef.current;
    if (!container) {
      showFeedback("download-error");
      return;
    }

    try {
      await downloadChartJpeg(container, filename, { aspect, title, value });
    } catch {
      showFeedback("download-error");
    }
  }

  const copyLabel =
    feedback === "copied" ? "Image copied" : feedback === "copy-error" ? "Could not copy image" : "Copy image";
  const downloadLabel = feedback === "download-error" ? "Could not save JPEG" : "Save JPEG";

  return (
    <Dialog.Root onOpenChange={handleOpenChange} open={open}>
      <Dialog.Trigger
        aria-label={`Share ${title}`}
        className={buttonVariants({
          className: "shrink-0 text-muted-foreground hover:text-foreground",
          size: "icon-sm",
          variant: "ghost",
        })}
        title="Share"
      >
        <Share2 aria-hidden="true" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px] transition-opacity duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:duration-[100ms] dark:bg-black/65" />
        <Dialog.Popup
          className={cn(
            "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl outline-none [clip-path:inset(0_0_0_0_round_1rem)] transition-[clip-path,opacity,width] duration-[430ms] ease-[cubic-bezier(0.2,0,0.2,1)] will-change-[clip-path] data-ending-style:[clip-path:inset(48%_48%_48%_48%_round_1rem)] data-starting-style:[clip-path:inset(48%_48%_48%_48%_round_1rem)] motion-reduce:duration-[140ms] motion-reduce:data-ending-style:opacity-0 motion-reduce:data-ending-style:[clip-path:inset(0_0_0_0_round_1rem)] motion-reduce:data-starting-style:opacity-0 motion-reduce:data-starting-style:[clip-path:inset(0_0_0_0_round_1rem)]",
            aspect === "social" ? "w-[min(92vw,calc(100dvh-14rem),60rem)]" : "w-[min(92vw,60rem)]",
          )}
        >
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold">Share Chart</Dialog.Title>
              <Dialog.Description className="sr-only">Preview and export this chart.</Dialog.Description>
            </div>
            <Dialog.Close
              aria-label="Close share dialog"
              className={buttonVariants({
                className: "text-muted-foreground hover:text-foreground",
                size: "icon-sm",
                variant: "ghost",
              })}
              title="Close"
            >
              <X aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-4 sm:p-6">
            <div
              className={cn(
                "flex min-h-56 items-center justify-center overflow-hidden bg-secondary",
                aspect === "social" ? "aspect-square w-full" : "h-full",
              )}
            >
              {previewUrl ? (
                <>
                  {/* The blob URL is the exact, maximum-quality JPEG copied or downloaded. */}
                  {/* biome-ignore lint/performance/noImgElement: Next Image cannot render a transient client-side blob URL */}
                  <img
                    alt={`${title} chart preview`}
                    className="block h-auto max-h-[calc(100dvh-17rem)] w-auto max-w-full object-contain"
                    src={previewUrl}
                  />
                </>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  {previewLoading ? "Preparing the exact copied image…" : "Chart preview is unavailable."}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Select
              onValueChange={(nextAspect) => handleAspectChange(nextAspect === "social" ? "social" : "default")}
              value={aspect}
            >
              <SelectTrigger aria-label="Export aspect ratio" className="h-9 border-border bg-background text-xs">
                <SelectValue>
                  {(selectedAspect) => (selectedAspect === "social" ? "Social Media" : "Default")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" className="min-w-28 rounded-xl" side="top" sideOffset={6}>
                <SelectItem className="min-h-8 rounded-lg py-1 text-xs" label="Default" value="default">
                  Default
                </SelectItem>
                <SelectItem className="min-h-8 rounded-lg py-1 text-xs" label="Social Media" value="social">
                  Social Media
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button className="w-fit text-xs" onClick={handleDownload} type="button" variant="secondary">
                {feedback === "download-error" ? <TriangleAlert aria-hidden="true" /> : <Download aria-hidden="true" />}{" "}
                {downloadLabel}
              </Button>
              <Button className="w-fit text-xs" onClick={handleCopy} type="button" variant="secondary">
                {feedback === "copied" ? (
                  <Check aria-hidden="true" />
                ) : feedback === "copy-error" ? (
                  <TriangleAlert aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )}{" "}
                {copyLabel}
              </Button>
            </div>
          </div>
          <span aria-live="polite" className="sr-only">
            {feedback === "copied"
              ? "Image copied to clipboard"
              : feedback === "copy-error"
                ? "Could not copy image"
                : feedback === "download-error"
                  ? "Could not save SVG"
                  : feedback === "preview-error"
                    ? "Chart preview is unavailable"
                    : ""}
          </span>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
