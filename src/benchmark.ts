import { readOdometer } from "./odometer";

const fixtures: Record<string, string> = import.meta.glob("/TestData/cropped/*.jpg", {
  eager: true,
  import: "default",
  query: "?url",
});
const results = document.querySelector<HTMLPreElement>("#benchmark-results")!;
const entries = Object.entries(fixtures).sort(([left], [right]) => left.localeCompare(right));
const matches: Array<{ expected: string; actual: string | null; filename: string }> = [];

async function runBenchmark(): Promise<void> {
  const lines = [`Running ${entries.length} cropped-image fixtures…`];
  results.textContent = lines.join("\n");

  for (const [index, [path, url]] of entries.entries()) {
    const filename = path.split("/").at(-1)!;
    const expected = filename.match(/^(\d+)(?:_[^.]+)?\.jpg$/i)?.[1];
    if (!expected) {
      throw new Error(`Fixture filename does not contain an expected reading: ${filename}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load ${filename}: ${response.status} ${response.statusText}`);
    }
    const file = new File([await response.blob()], filename, { type: "image/jpeg" });
    const detected = await readOdometer(file, "display");
    const actual = detected?.value ?? null;
    matches.push({ expected, actual, filename });
    lines[0] = `Processed ${index + 1} of ${entries.length}`;
    lines.push(`${actual === expected ? "PASS" : "FAIL"} ${filename}: expected ${expected}, got ${actual ?? "no reading"}`);
    results.textContent = lines.join("\n");
  }

  const passed = matches.filter(({ expected, actual }) => expected === actual).length;
  lines.push("", `Exact matches: ${passed}/${matches.length} (${matches.length ? (passed / matches.length * 100).toFixed(1) : "0.0"}%)`);
  results.textContent = lines.join("\n");
  document.documentElement.dataset.benchmarkComplete = "true";
}

void runBenchmark().catch((error: unknown) => {
  results.textContent = error instanceof Error
    ? `Benchmark failed: ${error.message}`
    : "Benchmark failed with an unknown error.";
  document.documentElement.dataset.benchmarkComplete = "error";
});
