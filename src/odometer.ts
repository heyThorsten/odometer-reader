import { createWorker, PSM } from "tesseract.js";

export type OdometerResult = {
  value: string;
  method: "custom" | "tesseract";
};

export type OdometerImageSource = "camera" | "display" | "cropped";

type Candidate = {
  value: string;
  score: number;
};

let workerPromise: ReturnType<typeof createWorker> | null = null;

function percentile(histogram: Uint32Array, threshold: number): number {
  let pixels = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    pixels += histogram[level];
    if (pixels >= threshold) return level;
  }
  return histogram.length - 1;
}

function getThresholdMetrics(
  histogram: Uint32Array,
  pixelCount: number,
): { threshold: number; score: number; foregroundAbove: boolean; foregroundFraction: number } {
  let total = 0;
  let totalSquares = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    total += level * histogram[level];
    totalSquares += level * level * histogram[level];
  }
  const totalVariance = totalSquares / pixelCount - (total / pixelCount) ** 2;
  let backgroundCount = 0;
  let backgroundSum = 0;
  let largestVariance = -1;
  let bestThreshold = 0;
  let foregroundAbove = true;
  let foregroundFraction = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    backgroundCount += histogram[level];
    if (backgroundCount === 0) continue;

    const foregroundCount = pixelCount - backgroundCount;
    if (foregroundCount === 0) break;

    backgroundSum += level * histogram[level];
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (total - backgroundSum) / foregroundCount;
    const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
    if (variance > largestVariance) {
      largestVariance = variance;
      bestThreshold = level;
      foregroundAbove = foregroundCount < backgroundCount;
      foregroundFraction = Math.min(backgroundCount, foregroundCount) / pixelCount;
    }
  }

  const balance = Math.max(0, 1 - Math.abs(foregroundFraction - 0.15) / 0.35);
  const separability = totalVariance > 0 ? largestVariance / (pixelCount ** 2 * totalVariance) : 0;
  return {
    threshold: bestThreshold,
    score: separability * balance,
    foregroundAbove,
    foregroundFraction,
  };
}

function getColorSignal(red: number, green: number, blue: number, channel: number): number {
  switch (channel) {
    case 0: return red;
    case 1: return green;
    case 2: return blue;
    case 3: return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    case 4: return Math.max(0, Math.min(255, red - green + 128));
    case 5: return Math.max(0, Math.min(255, red - blue + 128));
    default: return Math.max(0, Math.min(255, green - red + 128));
  }
}

function createOdometerCrop(
  bitmap: ImageBitmap,
  source: OdometerImageSource,
): { canvas: HTMLCanvasElement; foregroundMask: Uint8Array } {
  const sourceX = source === "camera" ? Math.round(bitmap.width * 0.25) : 0;
  const sourceY = source === "camera"
    ? Math.round(bitmap.height * 0.37)
    : source === "display" ? Math.round(bitmap.height * 0.16) : 0;
  const sourceWidth = source === "camera"
    ? Math.round(bitmap.width * 0.5)
    : source === "display" ? Math.round(bitmap.width * 0.8) : bitmap.width;
  const sourceHeight = source === "camera"
    ? Math.round(bitmap.height * 0.13)
    : source === "display" ? Math.round(bitmap.height * 0.74) : bitmap.height;
  const scale = Math.min(4, 3600 / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("This browser cannot process images.");
  }

  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  const colorHistograms = Array.from({ length: 7 }, () => new Uint32Array(256));
  const pixelCount = canvas.width * canvas.height;
  for (let pixel = 0, i = 0; pixel < pixelCount; pixel += 1, i += 4) {
    const red = image.data[i];
    const green = image.data[i + 1];
    const blue = image.data[i + 2];
    const luminance = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
    histogram[luminance] += 1;
    colorHistograms[0][red] += 1;
    colorHistograms[1][green] += 1;
    colorHistograms[2][blue] += 1;
    colorHistograms[3][luminance] += 1;
    colorHistograms[4][Math.max(0, Math.min(255, red - green + 128))] += 1;
    colorHistograms[5][Math.max(0, Math.min(255, red - blue + 128))] += 1;
    colorHistograms[6][Math.max(0, Math.min(255, green - red + 128))] += 1;
  }
  const foregroundChannel = colorHistograms
    .map((channelHistogram, index) => ({ ...getThresholdMetrics(channelHistogram, pixelCount), index }))
    .reduce((best, current) => current.score > best.score ? current : best);
  const foregroundMask = new Uint8Array(pixelCount);
  for (let pixel = 0, i = 0; pixel < pixelCount; pixel += 1, i += 4) {
    const red = image.data[i];
    const green = image.data[i + 1];
    const blue = image.data[i + 2];
    const signal = getColorSignal(red, green, blue, foregroundChannel.index);
    if (foregroundChannel.foregroundAbove ? signal > foregroundChannel.threshold : signal <= foregroundChannel.threshold) {
      foregroundMask[pixel] = 1;
    }
  }
  const blackPoint = percentile(histogram, pixelCount * 0.01);
  const whitePoint = percentile(histogram, pixelCount * 0.96);
  const contrast = 255 / Math.max(1, whitePoint - blackPoint);

  for (let i = 0; i < image.data.length; i += 4) {
    const luminance = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const enhanced = Math.max(0, Math.min(255, (luminance - blackPoint) * contrast));
    image.data[i] = enhanced;
    image.data[i + 1] = enhanced;
    image.data[i + 2] = enhanced;
  }
  context.putImageData(image, 0, 0);

  return { canvas, foregroundMask };
}

function recognizeSevenSegmentDigit(
  mask: Uint8Array,
  width: number,
  box: { x0: number; x1: number; y0: number; y1: number },
): { digit: string; errors: number } {
  if ((box.x1 - box.x0) / (box.y1 - box.y0) < 0.42) {
    return { digit: "1", errors: 0 };
  }

  const patterns: Record<string, string> = {
    "1111110": "0",
    "0110000": "1",
    "1101101": "2",
    "1111001": "3",
    "0110011": "4",
    "1011011": "5",
    "1011111": "6",
    "1110000": "7",
    "1111111": "8",
    "1111011": "9",
  };
  const regions = [
    [0.25, 0.08, 0.75, 0.27],
    [0.68, 0.19, 0.93, 0.43],
    [0.68, 0.57, 0.93, 0.81],
    [0.25, 0.73, 0.75, 0.92],
    [0.07, 0.57, 0.32, 0.81],
    [0.07, 0.19, 0.32, 0.43],
    [0.25, 0.43, 0.75, 0.58],
  ];
  const boxWidth = box.x1 - box.x0;
  const boxHeight = box.y1 - box.y0;
  const bits = regions.map(([left, top, right, bottom], index) => {
    const x0 = box.x0 + Math.floor(left * boxWidth);
    const x1 = box.x0 + Math.ceil(right * boxWidth);
    const y0 = box.y0 + Math.floor(top * boxHeight);
    const y1 = box.y0 + Math.ceil(bottom * boxHeight);
    let active = 0;
    let area = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        active += mask[y * width + x];
        area += 1;
      }
    }
    const activationThreshold = index === 6 ? 0.1 : 0.16;
    return area > 0 && active / area >= activationThreshold ? "1" : "0";
  }).join("");

  let bestDigit = "";
  let errors = regions.length;
  for (const [pattern, digit] of Object.entries(patterns)) {
    const distance = [...pattern].filter((bit, index) => bit !== bits[index]).length;
    if (distance < errors) {
      bestDigit = digit;
      errors = distance;
    }
  }
  return { digit: bestDigit, errors };
}

function findSevenSegmentReading(canvas: HTMLCanvasElement, mask: Uint8Array): OdometerResult | null {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("This browser cannot process images.");
  }

  const pixelCount = canvas.width * canvas.height;
  const columnCounts = new Uint32Array(canvas.width);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (mask[pixel]) columnCounts[pixel % canvas.width] += 1;
  }

  const minimumColumnPixels = Math.max(2, Math.round(canvas.height * 0.008));
  const maximumGap = 2;
  const groups: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  let start = -1;
  let lastActive = -1;
  const createBox = (x0: number, x1: number) => {
    let y0 = canvas.height;
    let y1 = 0;
    for (let x = x0; x < x1; x += 1) {
      for (let y = 0; y < canvas.height; y += 1) {
        if (mask[y * canvas.width + x]) {
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y + 1);
        }
      }
    }
    return { x0, x1, y0, y1 };
  };
  const finishGroup = (): void => {
    if (start < 0) return;
    const box = createBox(start, lastActive + 1);
    if (box.y1 - box.y0 >= canvas.height * 0.2) groups.push(box);
    start = -1;
  };

  for (let x = 0; x < canvas.width; x += 1) {
    if (columnCounts[x] <= minimumColumnPixels) continue;
    if (start < 0 || x - lastActive > maximumGap + 1) {
      finishGroup();
      start = x;
    }
    lastActive = x;
  }
  finishGroup();

  const widths = groups
    .filter((box) => (box.x1 - box.x0) / (box.y1 - box.y0) >= 0.22)
    .map(({ x0, x1 }) => x1 - x0)
    .sort((left, right) => left - right);
  if (widths.length === 0) return null;
  const medianWidth = widths[Math.floor(widths.length / 2)];
  const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
  for (const group of groups) {
    let splitAt = group.x0;
    while (group.x1 - splitAt > medianWidth * 1.3) {
      const searchStart = Math.max(splitAt + 1, Math.round(splitAt + medianWidth * 0.65));
      const searchEnd = Math.min(group.x1 - 1, Math.round(splitAt + medianWidth * 1.35));
      let boundary = searchStart;
      for (let x = searchStart + 1; x <= searchEnd; x += 1) {
        if (columnCounts[x] < columnCounts[boundary]) boundary = x;
      }
      if (boundary <= splitAt || boundary >= group.x1) break;
      const box = createBox(splitAt, boundary);
      const aspectRatio = (box.x1 - box.x0) / (box.y1 - box.y0);
      if (aspectRatio >= 0.05 && aspectRatio <= 0.9) boxes.push(box);
      splitAt = boundary;
    }
    const box = createBox(splitAt, group.x1);
    const aspectRatio = (box.x1 - box.x0) / (box.y1 - box.y0);
    if (aspectRatio >= 0.05 && aspectRatio <= 0.9) boxes.push(box);
  }
  if (boxes.length < 4) return null;

  const clusters: Array<Array<{ x0: number; x1: number; y0: number; y1: number }>> = [];
  for (const box of boxes) {
    const previous = clusters.at(-1);
    const previousBox = previous?.at(-1);
    if (!previousBox || box.x0 - previousBox.x1 > medianWidth * 0.75) {
      clusters.push([box]);
    } else {
      clusters[clusters.length - 1].push(box);
    }
  }
  const reading = boxes.length >= 6
    ? boxes.slice(0, 6)
    : clusters.find((cluster) => cluster.length >= 4 && cluster.length <= 7) ?? boxes.slice(0, 6);
  if (reading.length < 4) return null;

  const digits = reading.map((box) => recognizeSevenSegmentDigit(mask, canvas.width, box));
  if (digits.some(({ digit, errors }) => !digit || errors > 2)) return null;
  return { value: digits.map(({ digit }) => digit).join(""), method: "custom" };
}

function findReading(
  words: Array<{ text: string; confidence: number; bbox: { x0: number; x1: number; y0: number; y1: number } }>,
  width: number,
  height: number,
  preferLeft: boolean,
): OdometerResult | null {
  const candidates: Candidate[] = [];
  for (const word of words) {
    const value = word.text.replace(/\D/g, "");
    if (value.length < 4 || value.length > 7) continue;

    const centerX = (word.bbox.x0 + word.bbox.x1) / 2 / width;
    const centerY = (word.bbox.y0 + word.bbox.y1) / 2 / height;
    const horizontalScore = Math.max(0, 1 - Math.abs(centerX - 0.5) / 0.5);
    const verticalScore = Math.max(0, 1 - Math.abs(centerY - 0.5) / 0.6);
    candidates.push({
      value,
      score: word.confidence
        + (preferLeft ? Math.max(0, 1 - centerX) * 30 : horizontalScore * 12)
        + verticalScore * 16
        + (value.length >= 5 ? 8 : 0),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? { value: candidates[0].value, method: "tesseract" } : null;
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng").then(async (worker) => {
      try {
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789",
          tessedit_pageseg_mode: PSM.SINGLE_LINE,
        });
        return worker;
      } catch (error) {
        await worker.terminate();
        throw error;
      }
    });
  }

  try {
    return await workerPromise;
  } catch (error) {
    workerPromise = null;
    throw error;
  }
}

export async function readOdometer(file: File, source: OdometerImageSource = "camera"): Promise<OdometerResult | null> {
  const bitmap = await createImageBitmap(file);
  let focusedCrop: HTMLCanvasElement;
  let foregroundMask: Uint8Array;
  try {
    const prepared = createOdometerCrop(bitmap, source);
    focusedCrop = prepared.canvas;
    foregroundMask = prepared.foregroundMask;
  } finally {
    bitmap.close();
  }

  const segmentedReading = findSevenSegmentReading(focusedCrop, foregroundMask);
  if (segmentedReading) return segmentedReading;

  const worker = await getWorker();
  const { data } = await worker.recognize(focusedCrop, {}, { blocks: true });
  const words = data.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.flatMap((line) => line.words),
    ),
  ) ?? [];
  return findReading(words, focusedCrop.width, focusedCrop.height, source === "display");
}
