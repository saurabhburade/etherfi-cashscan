const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const CSS_VARIABLE_PATTERN = /var\(\s*(--[\w-]+)(?:\s*,[^)]*)?\)/g;
const EXPORT_SIDE_PADDING = 24;
const EXPORT_HEADER_HEIGHT = 80;
const EXPORT_BOTTOM_PADDING = 40;
const EXPORT_CARD_INSET = 24;
const EXPORT_CARD_RADIUS = 6;
const EXPORT_CROP = { top: 16, right: 8, bottom: 12, left: 12 } as const;
const EXPORT_FONT_FAMILY = "Inter, Arial, Helvetica, sans-serif";
const PIE_EXPORT_PADDING = 32;
const PIE_EXPORT_LEGEND_ROW_HEIGHT = 27;
const PIE_EXPORT_LEGEND_OPTICAL_OFFSET = 16;

export interface ChartSvgExportOptions {
  title?: string;
  value?: string;
}

interface ExportHeaderAlignment {
  left: number;
  right: number;
}

/**
 * Serializes the first SVG in a chart container with the inherited theme values
 * it needs to render independently from the dashboard.
 */
export function serializeChartSvg(container: HTMLElement, options: ChartSvgExportOptions = {}): string {
  const source = container.querySelector<SVGSVGElement>("svg");
  if (!source) {
    throw new Error("Cannot export chart SVG: the supplied container does not contain an SVG.");
  }

  const svg = source.cloneNode(true) as SVGSVGElement;
  const isPie = source.classList.contains("chart-pie-svg") || Boolean(container.querySelector(".chart-pie-center"));
  const headerAlignment = measureAxisAlignment(source);
  const legendOffset = measureLegendOffset(source);
  svg.setAttribute("xmlns", SVG_NAMESPACE);
  svg.setAttribute("font-family", EXPORT_FONT_FAMILY);
  setRenderedDimensions(source, svg);
  if (isPie) preparePieExport(source, svg, container, options.value?.trim());
  if (options.title?.trim()) {
    compactExportAxisTypography(svg);
    alignExportLegend(svg, legendOffset);
    cropChartCanvas(svg);
  }
  if (options.title?.trim()) expandCanvasForTitle(svg);

  const sourceStyles = getComputedStyle(source);
  const variables = collectReferencedVariables(svg.outerHTML, sourceStyles);
  const declarations = [...variables]
    .map((name) => `${name}: ${sourceStyles.getPropertyValue(name).trim()};`)
    .join(" ");
  const background = resolveCustomProperty("--background", sourceStyles) || sourceStyles.backgroundColor;
  const foreground = resolveCustomProperty("--foreground", sourceStyles) || sourceStyles.color;
  const secondary = resolveCustomProperty("--muted-foreground", sourceStyles) || foreground;
  const border = resolveCustomProperty("--border", sourceStyles) || sourceStyles.color;
  const embeddedStyle = document.createElementNS(SVG_NAMESPACE, "style");
  embeddedStyle.textContent = `svg, text { font-family: ${EXPORT_FONT_FAMILY}; } svg { ${declarations} background: ${background}; color: ${foreground}; }`;
  svg.insertBefore(embeddedStyle, svg.firstChild);
  const isDark = document.documentElement.classList.contains("dark");
  const card = isDark
    ? resolveCustomProperty("--card", sourceStyles) || background || sourceStyles.backgroundColor
    : resolveCustomProperty("--secondary", sourceStyles) ||
      resolveCustomProperty("--card", sourceStyles) ||
      background ||
      sourceStyles.backgroundColor;
  if (options.title?.trim()) {
    insertExportCard(svg, background, card, 0.4);
  } else {
    insertBackgroundRect(svg, card);
  }
  if (options.title?.trim())
    insertExportTitle(
      svg,
      options.title.trim(),
      isPie ? undefined : options.value?.trim(),
      foreground,
      secondary,
      border,
      headerAlignment,
    );

  return new XMLSerializer().serializeToString(svg);
}

/** Downloads a standalone SVG representation of the chart. */
export async function downloadChartJpeg(
  container: HTMLElement,
  filename: string,
  options: ChartSvgExportOptions = {},
): Promise<void> {
  const blob = await renderChartJpeg(container, options);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = sanitizeJpegFilename(filename);
  link.style.display = "none";

  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

/** Copies a maximum-resolution PNG rendering of the chart to the clipboard. */
export async function copyChartJpegFromElement(
  container: HTMLElement,
  options: ChartSvgExportOptions = {},
): Promise<void> {
  await copyChartJpeg(await renderChartJpeg(container, options));
}

/** Renders the same maximum-resolution, maximum-quality JPEG used by preview, clipboard, and download. */
export async function renderChartJpeg(container: HTMLElement, options: ChartSvgExportOptions = {}): Promise<Blob> {
  const source = container.querySelector<SVGSVGElement>("svg");
  if (!source) {
    throw new Error("Cannot export chart SVG: the supplied container does not contain an SVG.");
  }
  const bounds = source.getBoundingClientRect();
  if (!bounds.width || !bounds.height) {
    throw new Error("Cannot copy chart image: the chart has no rendered size.");
  }

  const markup = serializeChartSvg(container, options);
  const exportDimensions = serializedSvgSize(markup) ?? exportSize(bounds.width, bounds.height, options);
  return await renderSvgAsJpeg(markup, exportDimensions.width, exportDimensions.height);
}

/** Copies a previously rendered chart JPEG, keeping preview and clipboard pixels identical. */
export async function copyChartJpeg(jpegBlob: Blob): Promise<void> {
  if (!navigator.clipboard?.write) {
    throw new Error("Cannot copy chart image: clipboard.write is unavailable.");
  }
  if (typeof ClipboardItem === "undefined") {
    throw new Error("Cannot copy chart image: ClipboardItem is unavailable.");
  }

  const jpegSupported = typeof ClipboardItem.supports !== "function" || ClipboardItem.supports("image/jpeg");
  if (jpegSupported) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/jpeg": jpegBlob })]);
      return;
    } catch {
      // Chromium-based browsers commonly reject JPEG clipboard payloads.
    }
  }

  const pngBlob = await transcodeJpegToPng(jpegBlob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
}

async function transcodeJpegToPng(jpegBlob: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const image = new Image();
  const objectUrl = URL.createObjectURL(jpegBlob);

  try {
    await loadImage(image, objectUrl);
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot copy chart image: a 2D canvas context is unavailable.");
    context.drawImage(image, 0, 0);
    return await canvasToPng(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
    image.onload = null;
    image.onerror = null;
    image.src = "";
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function renderSvgAsJpeg(markup: string, width: number, height: number): Promise<Blob> {
  const maxDimension = Math.max(width, height);
  const scale = Math.min(4, 4096 / maxDimension);
  const canvas = document.createElement("canvas");
  const image = new Image();
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));

  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));

  try {
    await loadImage(image, svgUrl);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Cannot copy chart image: a 2D canvas context is unavailable.");
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasToJpeg(canvas);
  } finally {
    URL.revokeObjectURL(svgUrl);
    image.onload = null;
    image.onerror = null;
    image.src = "";
    canvas.width = 0;
    canvas.height = 0;
  }
}

function loadImage(image: HTMLImageElement, source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Cannot copy chart image: the SVG could not be rendered."));
    image.src = source;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Cannot copy chart image: JPEG canvas encoding is unavailable."));
      return;
    }

    try {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Cannot copy chart image: JPEG canvas encoding failed."));
          }
        },
        "image/jpeg",
        1,
      );
    } catch {
      reject(new Error("Cannot copy chart image: JPEG canvas encoding failed."));
    }
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("Cannot copy chart image: PNG canvas encoding is unavailable."));
      return;
    }

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Cannot copy chart image: PNG canvas encoding failed."));
    }, "image/png");
  });
}

function exportSize(width: number, height: number, options: ChartSvgExportOptions) {
  return options.title?.trim()
    ? {
        width: width - EXPORT_CROP.left - EXPORT_CROP.right + EXPORT_SIDE_PADDING * 2,
        height: height - EXPORT_CROP.top - EXPORT_CROP.bottom + EXPORT_HEADER_HEIGHT + EXPORT_BOTTOM_PADDING,
      }
    : { width, height };
}

function serializedSvgSize(markup: string): { width: number; height: number } | undefined {
  const document = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = document.documentElement;
  const width = numericDimension(svg.getAttribute("width"));
  const height = numericDimension(svg.getAttribute("height"));
  return width && height ? { width, height } : undefined;
}

function preparePieExport(
  source: SVGSVGElement,
  svg: SVGSVGElement,
  container: HTMLElement,
  exportValue?: string,
): void {
  const sourceViewBox = parseViewBox(source.getAttribute("viewBox"));
  const bounds = source.getBoundingClientRect();
  const sourceX = sourceViewBox?.[0] ?? 0;
  const sourceY = sourceViewBox?.[1] ?? 0;
  const sourceWidth = sourceViewBox?.[2] ?? bounds.width;
  const sourceHeight = sourceViewBox?.[3] ?? bounds.height;
  if (!sourceWidth || !sourceHeight) return;

  const legendRows = [...container.querySelectorAll<HTMLElement>("[data-chart-legend-label]")];
  const total = container.querySelector<HTMLElement>("[data-chart-legend-total]")?.dataset.chartLegendTotal;
  const exportWidth = legendRows.length
    ? Math.max(520, sourceWidth * 2.35 + PIE_EXPORT_PADDING)
    : sourceWidth + PIE_EXPORT_PADDING * 2;
  const totalHeight = total && legendRows.length ? 31 : 0;
  const legendHeight = legendRows.length * PIE_EXPORT_LEGEND_ROW_HEIGHT + totalHeight;
  const exportHeight = Math.max(sourceHeight + PIE_EXPORT_PADDING * 2, legendHeight + PIE_EXPORT_PADDING * 2);
  const chartX = PIE_EXPORT_PADDING;
  const chartY = (exportHeight - sourceHeight) / 2;
  const legendY = (exportHeight - legendHeight) / 2 + PIE_EXPORT_LEGEND_OPTICAL_OFFSET;

  const chart = document.createElementNS(SVG_NAMESPACE, "g");
  chart.setAttribute("data-export-pie-chart", "true");
  chart.setAttribute("transform", `translate(${chartX - sourceX} ${chartY - sourceY})`);
  while (svg.firstChild) chart.appendChild(svg.firstChild);
  svg.appendChild(chart);
  svg.setAttribute("viewBox", `0 0 ${exportWidth} ${exportHeight}`);
  svg.setAttribute("width", String(exportWidth));
  svg.setAttribute("height", String(exportHeight));

  const styles = getComputedStyle(source);
  const foreground = resolveCustomProperty("--foreground", styles) || styles.color;
  const secondary = resolveCustomProperty("--muted-foreground", styles) || foreground;
  const border = resolveCustomProperty("--border", styles) || secondary;
  const annotations = document.createElementNS(SVG_NAMESPACE, "g");
  annotations.setAttribute("data-export-pie-annotations", "true");
  annotations.setAttribute("font-family", EXPORT_FONT_FAMILY);

  const centerLines = [
    ...new Set(
      [exportValue, ...(container.querySelector<HTMLElement>(".chart-pie-center")?.innerText ?? "").split(/\n+/)]
        .map((line) => line?.trim())
        .filter((line): line is string => Boolean(line)),
    ),
  ].slice(0, 2);
  centerLines.forEach((line, index) => {
    const text = document.createElementNS(SVG_NAMESPACE, "text");
    text.setAttribute("x", String(chartX + sourceWidth / 2));
    text.setAttribute("y", String(chartY + sourceHeight / 2 + (index === 0 ? -2 : 18)));
    text.setAttribute("fill", index === 0 ? foreground : secondary);
    text.setAttribute("font-size", index === 0 ? "16" : "10");
    text.setAttribute("font-weight", index === 0 ? "500" : "400");
    text.setAttribute("text-anchor", "middle");
    text.textContent = line;
    annotations.appendChild(text);
  });

  const legendX = chartX + sourceWidth + 42;
  const legendValueX = exportWidth - PIE_EXPORT_PADDING;
  legendRows.forEach((row, index) => {
    const y = legendY + index * PIE_EXPORT_LEGEND_ROW_HEIGHT;
    const swatch = document.createElementNS(SVG_NAMESPACE, "circle");
    swatch.setAttribute("cx", String(legendX));
    swatch.setAttribute("cy", String(y - 3));
    swatch.setAttribute("r", "3");
    const swatchElement = row.querySelector<HTMLElement>(".chart-html-legend-swatch");
    swatch.setAttribute("fill", swatchElement ? getComputedStyle(swatchElement).backgroundColor : foreground);
    annotations.appendChild(swatch);

    const label = document.createElementNS(SVG_NAMESPACE, "text");
    label.setAttribute("x", String(legendX + 14));
    label.setAttribute("y", String(y));
    label.setAttribute("fill", secondary);
    label.setAttribute("font-size", "10");
    label.textContent = row.dataset.chartLegendLabel ?? "";
    annotations.appendChild(label);

    const value = document.createElementNS(SVG_NAMESPACE, "text");
    value.setAttribute("x", String(legendValueX));
    value.setAttribute("y", String(y));
    value.setAttribute("fill", foreground);
    value.setAttribute("font-size", "10");
    value.setAttribute("text-anchor", "end");
    value.textContent = row.dataset.chartLegendValue ?? "";
    annotations.appendChild(value);
  });

  if (total && legendRows.length) {
    const y = legendY + legendRows.length * PIE_EXPORT_LEGEND_ROW_HEIGHT;
    const divider = document.createElementNS(SVG_NAMESPACE, "line");
    divider.setAttribute("x1", String(legendX));
    divider.setAttribute("x2", String(legendValueX));
    divider.setAttribute("y1", String(y - 11));
    divider.setAttribute("y2", String(y - 11));
    divider.setAttribute("stroke", border);
    divider.setAttribute("stroke-opacity", "0.5");
    annotations.appendChild(divider);
    const totalText = document.createElementNS(SVG_NAMESPACE, "text");
    totalText.setAttribute("x", String(legendValueX));
    totalText.setAttribute("y", String(y + 7));
    totalText.setAttribute("fill", foreground);
    totalText.setAttribute("font-size", "11");
    totalText.setAttribute("text-anchor", "end");
    totalText.textContent = total;
    annotations.appendChild(totalText);
  }

  svg.appendChild(annotations);
}

function cropChartCanvas(svg: SVGSVGElement): void {
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) return;

  const [x, y, width, height] = viewBox;
  const croppedWidth = width - EXPORT_CROP.left - EXPORT_CROP.right;
  const croppedHeight = height - EXPORT_CROP.top - EXPORT_CROP.bottom;
  if (croppedWidth <= 0 || croppedHeight <= 0) return;

  svg.setAttribute("viewBox", `${x + EXPORT_CROP.left} ${y + EXPORT_CROP.top} ${croppedWidth} ${croppedHeight}`);
  svg.setAttribute("width", String(croppedWidth));
  svg.setAttribute("height", String(croppedHeight));
}

function expandCanvasForTitle(svg: SVGSVGElement): void {
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) return;

  const [x, y, width, height] = viewBox;
  const exportWidth = width + EXPORT_SIDE_PADDING * 2;
  const exportHeight = height + EXPORT_HEADER_HEIGHT + EXPORT_BOTTOM_PADDING;
  svg.setAttribute("viewBox", `${x - EXPORT_SIDE_PADDING} ${y - EXPORT_HEADER_HEIGHT} ${exportWidth} ${exportHeight}`);
  svg.setAttribute("width", String(exportWidth));
  svg.setAttribute("height", String(exportHeight));
}

function insertExportTitle(
  svg: SVGSVGElement,
  title: string,
  value: string | undefined,
  foreground: string,
  secondary: string,
  border: string,
  alignment?: ExportHeaderAlignment,
): void {
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) return;

  const [x, y, width] = viewBox;
  const originalX = x + EXPORT_SIDE_PADDING;
  const originalWidth = width - EXPORT_SIDE_PADDING * 2;
  const headerLeft = alignment?.left ?? originalX + 24;
  const headerRight = alignment?.right ?? originalX + originalWidth - 18;
  const titleElement = document.createElementNS(SVG_NAMESPACE, "text");
  titleElement.setAttribute("x", String(headerLeft));
  titleElement.setAttribute("y", String(y + 54));
  titleElement.setAttribute("fill", foreground);
  titleElement.setAttribute("font-family", EXPORT_FONT_FAMILY);
  titleElement.setAttribute("font-size", "12");
  titleElement.setAttribute("font-weight", "500");
  titleElement.style.fontWeight = "500";
  titleElement.textContent = title;

  const divider = document.createElementNS(SVG_NAMESPACE, "line");
  divider.setAttribute("x1", String(x + EXPORT_CARD_INSET));
  divider.setAttribute("x2", String(x + width - EXPORT_CARD_INSET));
  divider.setAttribute("y1", String(y + 74));
  divider.setAttribute("y2", String(y + 74));
  divider.setAttribute("stroke", border);
  divider.setAttribute("stroke-opacity", "0.45");

  const valueElement = value ? document.createElementNS(SVG_NAMESPACE, "text") : null;
  if (valueElement) {
    valueElement.setAttribute("x", String(headerRight));
    valueElement.setAttribute("y", String(y + 54));
    valueElement.setAttribute("fill", secondary);
    valueElement.setAttribute("font-family", EXPORT_FONT_FAMILY);
    valueElement.setAttribute("font-size", "12");
    valueElement.setAttribute("font-weight", "500");
    valueElement.setAttribute("text-anchor", "end");
    valueElement.textContent = value ?? "";
  }

  const firstChartChild = [...svg.children].find(
    (child) =>
      !["defs", "desc", "metadata", "style", "title"].includes(child.localName) &&
      !child.hasAttribute("data-export-background"),
  );
  svg.insertBefore(titleElement, firstChartChild ?? null);
  svg.insertBefore(divider, firstChartChild ?? null);
  if (valueElement) svg.insertBefore(valueElement, firstChartChild ?? null);
}

function measureAxisAlignment(svg: SVGSVGElement): ExportHeaderAlignment | undefined {
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return undefined;
  const viewBox = parseViewBox(svg.getAttribute("viewBox")) ?? [0, 0, bounds.width, bounds.height];

  const yLabels = [...svg.querySelectorAll<SVGTextElement>(".chart-cartesian-y-axis text")];
  const xLabels = [...svg.querySelectorAll<SVGTextElement>(".chart-cartesian-x-axis text")];
  if (!yLabels.length || !xLabels.length) return undefined;

  const yBounds = yLabels.map((label) => label.getBoundingClientRect()).filter((labelBounds) => labelBounds.width > 0);
  const xBounds = xLabels.map((label) => label.getBoundingClientRect()).filter((labelBounds) => labelBounds.width > 0);
  if (!yBounds.length || !xBounds.length) return undefined;

  const scale = viewBox[2] / bounds.width;
  return {
    left: viewBox[0] + (Math.min(...yBounds.map((labelBounds) => labelBounds.left)) - bounds.left) * scale,
    right: viewBox[0] + (Math.max(...xBounds.map((labelBounds) => labelBounds.right)) - bounds.left) * scale,
  };
}

function measureLegendOffset(svg: SVGSVGElement): number {
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return 0;
  const viewBox = parseViewBox(svg.getAttribute("viewBox")) ?? [0, 0, bounds.width, bounds.height];
  const legend = svg.querySelector<SVGGElement>(".chart-svg-legend");
  const yLabels = [...svg.querySelectorAll<SVGTextElement>(".chart-cartesian-y-axis text")];
  if (!legend || !yLabels.length) return 0;

  const legendBounds = legend.getBoundingClientRect();
  const zeroLabelBounds = yLabels
    .map((label) => label.getBoundingClientRect())
    .filter((labelBounds) => labelBounds.width > 0)
    .sort((first, second) => second.bottom - first.bottom)[0];
  if (!legendBounds.width || !zeroLabelBounds) return 0;

  return (zeroLabelBounds.left - legendBounds.left) * (viewBox[2] / bounds.width);
}

function alignExportLegend(svg: SVGSVGElement, offset: number): void {
  if (!Number.isFinite(offset) || Math.abs(offset) < 0.5) return;
  svg.querySelectorAll<SVGGElement>(".chart-svg-legend").forEach((legend) => {
    const transform = legend.getAttribute("transform")?.trim();
    legend.setAttribute("transform", `translate(${offset} 0)${transform ? ` ${transform}` : ""}`);
  });
}

function compactExportAxisTypography(svg: SVGSVGElement): void {
  svg.querySelectorAll<SVGGElement>(".chart-cartesian-x-axis, .chart-cartesian-y-axis").forEach((axis) => {
    axis.setAttribute("font-size", "9");
  });
  svg.querySelectorAll<SVGGElement>(".chart-svg-legend").forEach((legend) => {
    legend.setAttribute("font-size", "9");
  });
}

function collectReferencedVariables(markup: string, styles: CSSStyleDeclaration): Set<string> {
  const variables = new Set<string>();
  const pending = extractVariables(markup);

  while (pending.length) {
    const name = pending.pop();
    if (!name || variables.has(name)) continue;

    variables.add(name);
    pending.push(...extractVariables(styles.getPropertyValue(name)));
  }

  return variables;
}

function extractVariables(value: string): string[] {
  const variables: string[] = [];
  CSS_VARIABLE_PATTERN.lastIndex = 0;
  let match = CSS_VARIABLE_PATTERN.exec(value);
  while (match) {
    variables.push(match[1]);
    match = CSS_VARIABLE_PATTERN.exec(value);
  }

  return variables;
}

function resolveCustomProperty(name: string, styles: CSSStyleDeclaration): string {
  let value = styles.getPropertyValue(name).trim();
  const resolved = new Set<string>([name]);

  while (value) {
    CSS_VARIABLE_PATTERN.lastIndex = 0;
    const match = CSS_VARIABLE_PATTERN.exec(value);
    if (!match) return value;

    const dependency = match[1];
    if (resolved.has(dependency)) return "";

    const replacement = styles.getPropertyValue(dependency).trim();
    if (!replacement) return "";

    resolved.add(dependency);
    value = value.replace(match[0], replacement);
  }

  return "";
}

function insertBackgroundRect(svg: SVGSVGElement, fill: string): void {
  const background = document.createElementNS(SVG_NAMESPACE, "rect");
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));

  background.setAttribute("fill", fill);
  background.setAttribute("data-export-background", "true");
  background.setAttribute("pointer-events", "none");
  if (viewBox) {
    background.setAttribute("x", String(viewBox[0]));
    background.setAttribute("y", String(viewBox[1]));
    background.setAttribute("width", String(viewBox[2]));
    background.setAttribute("height", String(viewBox[3]));
  } else {
    background.setAttribute("width", "100%");
    background.setAttribute("height", "100%");
  }

  const firstVisualChild = [...svg.children].find(
    (child) => !["defs", "desc", "metadata", "style", "title"].includes(child.localName),
  );
  svg.insertBefore(background, firstVisualChild ?? null);
}

function insertExportCard(svg: SVGSVGElement, canvasFill: string, cardFill: string, cardOpacity = 1): void {
  const viewBox = parseViewBox(svg.getAttribute("viewBox"));
  if (!viewBox) {
    insertBackgroundRect(svg, cardFill);
    return;
  }

  const [x, y, width, height] = viewBox;
  const canvas = document.createElementNS(SVG_NAMESPACE, "rect");
  canvas.setAttribute("x", String(x));
  canvas.setAttribute("y", String(y));
  canvas.setAttribute("width", String(width));
  canvas.setAttribute("height", String(height));
  canvas.setAttribute("fill", canvasFill);
  canvas.setAttribute("data-export-background", "true");
  canvas.setAttribute("pointer-events", "none");

  const card = document.createElementNS(SVG_NAMESPACE, "rect");
  card.setAttribute("x", String(x + EXPORT_CARD_INSET));
  card.setAttribute("y", String(y + EXPORT_CARD_INSET));
  card.setAttribute("width", String(width - EXPORT_CARD_INSET * 2));
  card.setAttribute("height", String(height - EXPORT_CARD_INSET * 2));
  card.setAttribute("rx", String(EXPORT_CARD_RADIUS));
  card.setAttribute("fill", cardFill);
  card.setAttribute("fill-opacity", String(cardOpacity));
  card.setAttribute("data-export-background", "true");
  card.setAttribute("pointer-events", "none");

  const firstVisualChild = [...svg.children].find(
    (child) => !["defs", "desc", "metadata", "style", "title"].includes(child.localName),
  );
  svg.insertBefore(canvas, firstVisualChild ?? null);
  svg.insertBefore(card, firstVisualChild ?? null);
}

function setRenderedDimensions(source: SVGSVGElement, target: SVGSVGElement): void {
  const bounds = source.getBoundingClientRect();
  const width = positiveDimension(bounds.width) ?? numericDimension(source.getAttribute("width"));
  const height = positiveDimension(bounds.height) ?? numericDimension(source.getAttribute("height"));

  if (!target.hasAttribute("width")) {
    target.setAttribute("width", String(width ?? bounds.width));
  }
  if (!target.hasAttribute("height")) {
    target.setAttribute("height", String(height ?? bounds.height));
  }
  if (!parseViewBox(target.getAttribute("viewBox")) && width && height) {
    target.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
}

function parseViewBox(value: string | null): [number, number, number, number] | undefined {
  const values = value
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (!values || values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) {
    return undefined;
  }

  return [values[0], values[1], values[2], values[3]];
}

function positiveDimension(value: number): number | undefined {
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function numericDimension(value: string | null): number | undefined {
  return value === null ? undefined : positiveDimension(Number(value));
}

function sanitizeJpegFilename(filename: string): string {
  const sanitized = Array.from(filename.trim(), (character) =>
    character.charCodeAt(0) <= 0x1f || '<>:"/\\|?*'.includes(character) ? "-" : character,
  )
    .join("")
    .replace(/^\.+$/, "")
    .trim();
  const baseName = (sanitized || "chart").replace(/\.(?:svg|jpe?g|png)$/i, "");

  return `${baseName || "chart"}.jpg`;
}
