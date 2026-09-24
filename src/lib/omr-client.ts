type ConvertInput = {
  data: {
    filename: string;
    image: string;
    pageNumber: number;
    totalPages: number;
    context?: { partList: string; firstMeasure: number; lastAttributes: string };
  };
};

/** Streams page recognition so long conversions don't time out. */
export async function convertPage({ data }: ConvertInput): Promise<{ musicxml: string }> {
  const res = await fetch("/api/omr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(raw.trim() || `Recognition failed (${res.status}).`);

  const cleaned = raw
    .trim()
    .replace(/^```(?:xml)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("<?xml");
  const xml = start > 0 ? cleaned.slice(start) : cleaned;
  if (!xml.includes("<score-partwise")) {
    throw new Error(
      "No music notation could be recognised on this page. Try a clearer or higher-resolution PDF.",
    );
  }
  return { musicxml: xml };
}
