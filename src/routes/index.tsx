import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

import { convertPage } from "@/lib/omr-client";
import { supabase } from "@/integrations/supabase/client";
import { parseXml, scoreWarnings } from "@/lib/musicxml";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Score Converter — Sheet music PDF to editable MusicXML" },
      {
        name: "description",
        content:
          "Upload a sheet music PDF, turn it into an editable score, rewrite the lyrics and download MusicXML or a printable PDF.",
      },
      { property: "og:title", content: "Score Converter — PDF sheet music to editable MusicXML" },
      {
        property: "og:description",
        content:
          "Convert printed choir sheet music into an editable score, translate the lyrics and download MusicXML.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UploadPage,
});

const MAX_PAGES = 8;
const MAX_BYTES = 20 * 1024 * 1024;
const O_HOLY_NIGHT_TEMPLATE_ID = "5a1e0000-0000-4000-8000-000000000001";

const STEPS = [
  "Reading your PDF",
  "Rendering pages",
  "Recognising page 1",
  "Creating MusicXML",
  "Preparing editable score",
] as const;

function UploadPage() {
  const navigate = useNavigate();
  const convert = convertPage;
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback((selected: File | undefined) => {
    setError(null);
    if (!selected) return;
    if (selected.type !== "application/pdf") {
      setError("Please choose a PDF file.");
      return;
    }
    if (selected.size > MAX_BYTES) {
      setError("That file is larger than 20 MB. Please upload a smaller PDF.");
      return;
    }
    setFile(selected);
  }, []);

  async function renderPages(pdfFile: File): Promise<string[]> {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const workerUrl = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;


    const buffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const count = Math.min(pdf.numPages, MAX_PAGES);
    const images: string[] = [];

    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.2, 1600 / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser could not render the PDF pages.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL("image/jpeg", 0.85));
    }
    return images;
  }

  async function handleConvert() {
    if (!file) return;
    setError(null);
    try {
      setStep(0);
      const pages = await renderPages(file);
      setStep(2);
      const { musicxml } = await convert({
        data: { filename: file.name, image: pages[0]!, pageNumber: 1, totalPages: pages.length },
      });
      setStep(3);

      const warnings = scoreWarnings(parseXml(musicxml));
      const { data, error: dbError } = await supabase
        .from("scores")
        .insert({
          filename: file.name,
          original_musicxml: musicxml,
          page_images: pages,
          page_xml: [musicxml],
          page_count: pages.length,
          warnings: warnings.join(" "),
        })
        .select("id")
        .single();
      if (dbError) throw new Error(dbError.message);

      setStep(4);
      navigate({ to: "/editor/$scoreId", params: { scoreId: data.id } });
    } catch (e) {
      setStep(null);
      setError(e instanceof Error ? e.message : "Conversion failed. Please try again.");
    }
  }

  if (step !== null) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md">
          <h1 className="text-center text-3xl">Analyzing your sheet music…</h1>
          <ol className="mt-8 space-y-3">
            {STEPS.map((label, index) => (
              <li
                key={label}
                className={`flex items-center gap-3 text-sm ${
                  index <= step ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    index < step
                      ? "bg-primary"
                      : index === step
                        ? "animate-pulse bg-primary"
                        : "bg-border"
                  }`}
                />
                {label}
              </li>
            ))}
          </ol>
          <p className="mt-8 text-center text-xs text-muted-foreground">
            Pages are converted one at a time. You review each page before the next one starts.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Music Score Converter
        </p>
        <h1 className="mt-4 text-4xl sm:text-5xl">Turn a printed score into an editable one</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Upload a sheet music PDF, rewrite the lyrics, and download MusicXML for MuseScore,
          Dorico or Sibelius.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`score-sheet mt-10 cursor-pointer px-8 py-14 transition-colors ${
            dragging ? "border-primary bg-accent/40" : ""
          }`}
          onClick={() => inputRef.current?.click()}
        >
          <p className="text-lg">{file ? file.name : "Drop your sheet music PDF here"}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {file ? "Ready to convert" : `PDF only, up to ${MAX_PAGES} pages`}
          </p>
          <Button variant="outline" className="mt-6" type="button">
            Browse files
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </div>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <Button size="lg" className="mt-8" disabled={!file} onClick={handleConvert}>
          Convert to Editable Score
        </Button>

        <div className="mt-8 border-t pt-8">
          <p className="text-sm text-muted-foreground">Your converted 14-page SATB score is ready.</p>
          <Button variant="secondary" className="mt-3" asChild>
            <Link to="/editor/$scoreId" params={{ scoreId: O_HOLY_NIGHT_TEMPLATE_ID }}>
              Open O Holy Night Template
            </Link>
          </Button>
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          Recognition is automatic, so always check the notes and lyrics before downloading.
        </p>
      </div>
    </main>
  );
}
