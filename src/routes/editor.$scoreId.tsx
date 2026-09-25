import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  applySyllables,
  applyScoreDetails,
  collectScoreDetails,
  collectSyllables,
  parseXml,
  scoreWarnings,
  serializeXml,
  type Syllable,
  type ScoreDetails,
} from "@/lib/musicxml";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

import { convertPage } from "@/lib/omr-client";
import { continuationContext, mergePages } from "@/lib/musicxml";

export const Route = createFileRoute("/editor/$scoreId")({
  head: () => ({
    meta: [
      { title: "Score Editor — edit lyrics and export MusicXML" },
      {
        name: "description",
        content:
          "View your converted score, replace lyric syllables without touching the notes, and download MusicXML or a printable PDF.",
      },
      { property: "og:title", content: "Score Editor — edit lyrics and export MusicXML" },
      {
        property: "og:description",
        content: "Edit the lyrics of your converted sheet music and export MusicXML.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditorPage,
});

function EditorPage() {
  const { scoreId } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["score", scoreId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scores")
        .select("id, filename, original_musicxml, edited_musicxml, warnings, page_xml, page_images, page_count")
        .eq("id", scoreId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("This score could not be found.");
      return data;
    },
  });

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading your score…</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "This score could not be found."}
        </p>
        <Link to="/" className="text-sm underline">
          Start again
        </Link>
      </main>
    );
  }

  return (
    <PagedEditor
      scoreId={scoreId}
      filename={data.filename}
      initialPages={data.page_xml.length ? data.page_xml : [data.edited_musicxml || data.original_musicxml]}
      images={data.page_images}
      pageCount={Math.max(data.page_count, data.page_xml.length, 1)}
    />
  );
}

function PagedEditor({
  scoreId,
  filename,
  initialPages,
  images,
  pageCount,
}: {
  scoreId: string;
  filename: string;
  initialPages: string[];
  images: string[];
  pageCount: number;
}) {
  const convert = convertPage;
  const [pages, setPages] = useState<string[]>(initialPages);
  const [current, setCurrent] = useState(initialPages.length - 1);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const drafts = useRef<Record<number, string>>({});

  function collected(): string[] {
    return pages.map((xml, i) => drafts.current[i] ?? xml);
  }

  async function persist(next: string[]) {
    const merged = mergePages(next);
    const { error } = await supabase
      .from("scores")
      .update({ page_xml: next, edited_musicxml: merged.xml })
      .eq("id", scoreId);
    if (error) throw new Error(error.message);
    return merged;
  }

  async function save() {
    const next = collected();
    setPages(next);
    await persist(next);
  }

  async function approveAndContinue() {
    setConvertError(null);
    setConverting(true);
    try {
      const next = collected();
      drafts.current = {};
      setPages(next);
      await persist(next);
      const pageNumber = next.length + 1;
      const image = images[pageNumber - 1];
      if (!image) throw new Error("The image for the next page is missing. Please upload again.");
      const { musicxml } = await convert({
        data: {
          filename,
          image,
          pageNumber,
          totalPages: pageCount,
          context: continuationContext(next[next.length - 1]!),
        },
      });
      parseXml(musicxml);
      const withNew = [...next, musicxml];
      setPages(withNew);
      await persist(withNew);
      setCurrent(withNew.length - 1);
      toast.success(`Page ${pageNumber} is ready to review.`);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : "Converting the next page failed.");
    } finally {
      setConverting(false);
    }
  }

  function exportMerged() {
    return mergePages(collected());
  }

  const remaining = pageCount - pages.length;

  return (
    <div>
      {pageCount > 1 && images.length > 0 && <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pt-6 sm:px-8">
        <span className="mr-2 text-xs uppercase tracking-widest text-muted-foreground">Pages</span>
        {Array.from({ length: pageCount }, (_, i) => (
          <Button
            key={i}
            size="sm"
            variant={i === current ? "default" : "outline"}
            disabled={i >= pages.length}
            onClick={() => setCurrent(i)}
          >
            {i + 1}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {remaining > 0 ? (
            <Button onClick={approveAndContinue} disabled={converting}>
              {converting
                ? `Converting page ${pages.length + 1}…`
                : `Approve & convert page ${pages.length + 1}`}
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">All {pageCount} pages converted</span>
          )}
        </div>
      </nav>}
      {convertError && (
        <p className="mx-auto mt-3 max-w-6xl px-4 text-sm text-destructive sm:px-8">{convertError}</p>
      )}
      <Editor
        key={`${current}-${pages.length}`}
        filename={filename}
        pageLabel={`Page ${current + 1} of ${pageCount}` + (remaining > 0 ? ` · ${pages.length} converted` : "")}
        xml={drafts.current[current] ?? pages[current] ?? ""}
        onDraft={(xml) => {
          drafts.current[current] = xml;
        }}
        onSave={save}
        getExport={exportMerged}
      />
    </div>
  );
}

function Editor({
  filename,
  pageLabel,
  xml,
  onDraft,
  onSave,
  getExport,
}: {
  filename: string;
  pageLabel: string;
  xml: string;
  onDraft: (xml: string) => void;
  onSave: () => Promise<void>;
  getExport: () => { xml: string; warnings: string[] };
}) {
  const doc = useMemo(() => parseXml(xml), [xml]);
  const [syllables, setSyllables] = useState<Syllable[]>(() => collectSyllables(doc));
  const [scoreDetails, setScoreDetails] = useState<ScoreDetails>(() => collectScoreDetails(doc));
  const [currentXml, setCurrentXml] = useState(xml);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [activeSyllable, setActiveSyllable] = useState<number | null>(null);
  const warnings = useMemo(() => scoreWarnings(doc), [doc]);
  const syllablesRef = useRef(syllables);
  syllablesRef.current = syllables;
  type Snap = { syllables: Syllable[]; details: ScoreDetails };
  const undoStack = useRef<Snap[]>([]);
  const redoStack = useRef<Snap[]>([]);
  const lastPush = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [, forceHistory] = useState(0);
  function pushHistory(key: string) {
    const now = Date.now();
    if (lastPush.current.key === key && now - lastPush.current.at < 1200) {
      lastPush.current.at = now;
      return;
    }
    lastPush.current = { key, at: now };
    undoStack.current.push({ syllables: syllablesRef.current, details: scoreDetails });
    if (undoStack.current.length > 300) undoStack.current.shift();
    redoStack.current = [];
    forceHistory((n) => n + 1);
  }
  function restore(snap: Snap) {
    setSyllables(snap.syllables);
    setScoreDetails(snap.details);
    snap.syllables.forEach((syl, i) => {
      const t = lyricNodes.current[i]?.querySelector("text");
      if (t && t.textContent !== (syl.text || "lyrics")) t.textContent = syl.text || "lyrics";
    });
    const d = parseXml(currentXml);
    applySyllables(d, snap.syllables);
    onDraft(serializeXml(d));
    setDirty(true);
    lastPush.current = { key: "", at: 0 };
    forceHistory((n) => n + 1);
  }
  function undo() {
    const snap = undoStack.current.pop();
    if (!snap) return;
    redoStack.current.push({ syllables: syllablesRef.current, details: scoreDetails });
    restore(snap);
  }
  function redo() {
    const snap = redoStack.current.pop();
    if (!snap) return;
    undoStack.current.push({ syllables: syllablesRef.current, details: scoreDetails });
    restore(snap);
  }
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  undoRef.current = undo;
  redoRef.current = redo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undoRef.current(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redoRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const container = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const lyricNodes = useRef<SVGElement[]>([]);
  const openInlineRef = useRef<(i: number) => void>(() => {});
  const [inlinePos, setInlinePos] = useState<{ left: number; top: number; width: number } | null>(null);
  const osmd = useRef<import("opensheetmusicdisplay").OpenSheetMusicDisplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
      if (cancelled || !container.current) return;
      if (!osmd.current) {
        osmd.current = new OpenSheetMusicDisplay(container.current, {
          autoResize: false,
          backend: "svg",
          drawTitle: false,
          pageFormat: "Endless",
          newSystemFromXML: true,
          newSystemFromNewPageInXML: true,
          newPageFromXML: false,
        });
      }
      try {
        const loadable = /^\s*<\?xml/.test(currentXml)
          ? currentXml
          : '<?xml version="1.0" encoding="UTF-8"?>\n' + currentXml.replace(/^\s+/, "");
        await osmd.current.load(loadable);
        if (!cancelled) setRenderError(null);
        if (!cancelled) {
          const rules = osmd.current.EngravingRules;
          rules.PageLeftMargin = 2.8;
          rules.PageRightMargin = 2.8;
          rules.PageTopMargin = 3;
          rules.PageBottomMargin = 3;
          rules.MinimumDistanceBetweenSystems = 2;
          rules.MinSkyBottomDistBetweenSystems = 1.5;
          rules.StaffDistance = 5.5;
          rules.BetweenStaffDistance = 4.5;
          rules.LyricsHeight = 1.8;
          osmd.current.render();
          requestAnimationFrame(() => {
            if (cancelled || !osmd.current || !container.current) return;
            // Map each drawn lyric to the exact XML syllable (by part + measure + order)
            const buckets = new Map<string, number[]>();
            syllablesRef.current.forEach((syl, i) => {
              const k = `${syl.partIndex}|${syl.measure}`;
              if (!buckets.has(k)) buckets.set(k, []);
              buckets.get(k)!.push(i);
            });
            const used = new Map<string, number>();
            const lyricEntries: { entry: any; index: number }[] = [];
            osmd.current.GraphicSheet.MeasureList.forEach((row) => {
              row.forEach((measure, staffIdx) => {
                if (!measure) return;
                const k = `${staffIdx}|${measure.MeasureNumber}`;
                const list = buckets.get(k) ?? [];
                (measure.staffEntries ?? []).forEach((se) => {
                  (se.LyricsEntries ?? []).forEach((entry) => {
                    const n = used.get(k) ?? 0;
                    used.set(k, n + 1);
                    const index = list[n];
                    if (index !== undefined) lyricEntries.push({ entry, index });
                  });
                });
              });
            });
            lyricNodes.current = [];
            lyricEntries.forEach(({ entry, index }) => {
              const node = entry.GraphicalLabel?.SVGNode as SVGElement | undefined;
              if (!node) return;
              lyricNodes.current[index] = node;
              node.classList.add("editable-score-lyric");
              const textNode = node.querySelector("text");
              if (textNode) textNode.textContent = syllablesRef.current[index]?.text ?? textNode.textContent;
              if (textNode && !(textNode.textContent ?? "").replace(/\u200b/g, "").trim()) {
                textNode.textContent = "lyrics";
                node.classList.add("empty-score-lyric");
              }
              node.setAttribute("role", "button");
              node.setAttribute("tabindex", "0");
              node.setAttribute("aria-label", `Edit lyric ${index + 1}`);
              const select = () => openInlineRef.current(index);
              node.addEventListener("click", select);
              node.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") select();
              });
            });
          });
        }
      } catch {
        if (!cancelled) setRenderError("The recognised notation could not be displayed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentXml]);

  openInlineRef.current = (i: number) => openInline(i);
  function openInline(index: number) {
    const node = lyricNodes.current[index];
    const wrap = wrapper.current;
    if (!node || !wrap) return;
    const r = node.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    const width = Math.max(r.width + 24, 64);
    setInlinePos({
      left: r.left - w.left + wrap.scrollLeft + r.width / 2 - width / 2,
      top: r.top - w.top + wrap.scrollTop + r.height / 2 - 14,
      width,
    });
    setActiveSyllable(index);
  }

  function updateSyllable(index: number, text: string) {
    pushHistory(`syl-${index}`);
    const next = syllablesRef.current.map((s, i) => (i === index ? { ...s, text } : s));
    syllablesRef.current = next;
    setSyllables(next);
    const d = parseXml(currentXml);
    applySyllables(d, next);
    onDraft(serializeXml(d));
    const t = lyricNodes.current[index]?.querySelector("text");
    if (t) t.textContent = text || "lyrics";
    setDirty(true);
  }

  function buildXml(): string {
    const next = parseXml(currentXml);
    applySyllables(next, syllables);
    applyScoreDetails(next, scoreDetails);
    return serializeXml(next);
  }

  function updateScoreDetails(field: keyof ScoreDetails, value: string) {
    pushHistory(`det-${field}`);
    setScoreDetails((previous) => ({ ...previous, [field]: value }));
    setDirty(true);
  }

  function applyToScore() {
    const next = buildXml();
    setCurrentXml(next);
    onDraft(next);
    return next;
  }

  async function save() {
    setSaving(true);
    try {
      applyToScore();
      await onSave();
      setDirty(false);
      toast.success("Your lyric changes are saved.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Saving failed.");
    } finally {
      setSaving(false);
    }
  }

  function download() {
    applyToScore();
    const merged = getExport();
    merged.warnings.forEach((w) => toast.warning(w));
    let next = merged.xml.replace(/^\s*<\?xml[^>]*\?>\s*/, "");
    if (!/<!DOCTYPE/i.test(next)) {
      next =
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
        next;
    }
    next = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' + next;
    const blob = new Blob([next], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      filename.replace(/\.(pdf|musicxml|xml)$/i, "").replace(/[^\w\- ]+/g, "").trim() + ".xml";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportPdf() {
    applyToScore();
    const merged = getExport();
    if (osmd.current) {
      await osmd.current.load(merged.xml);
      osmd.current.render();
    }
    setTimeout(() => {
      window.print();
      setCurrentXml(buildXml() + " ");
    }, 300);
  }

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl">Score Editor</h1>
          <p className="text-sm text-muted-foreground">{filename} · {pageLabel}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" asChild>
            <Link to="/">New upload</Link>
          </Button>
          <Button variant="outline" onClick={undo} disabled={undoStack.current.length === 0} title="Undo (Ctrl+Z)">
            ↶ Undo
          </Button>
          <Button variant="outline" onClick={redo} disabled={redoStack.current.length === 0} title="Redo (Ctrl+Y)">
            ↷ Redo
          </Button>
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
          <Button onClick={download}>Download MusicXML (all pages)</Button>
          <Button variant="secondary" onClick={exportPdf}>
            Export PDF
          </Button>
        </div>
      </header>

      {(warnings.length > 0 || renderError) && (
        <div className="mx-auto mt-6 max-w-6xl rounded-md border border-accent bg-accent/40 px-4 py-3 text-sm">
          {warnings.join(" ")} Some parts of this sheet may not have been recognised accurately.
          Please review the converted score before downloading.
          {renderError ? ` ${renderError}` : ""}
        </div>
      )}


      <div className="mx-auto mt-6 max-w-6xl">
        <p className="mb-3 text-sm text-muted-foreground">
          Bofya lyric yoyote chini ya noti uiandike hapo hapo. Enter/Tab huenda lyric inayofuata. Ukimaliza bofya Save.
        </p>
        <div id="score-print" ref={wrapper} className="score-sheet score-pages relative overflow-x-auto p-2 sm:p-4">
          <section className="score-title-editor mx-auto max-w-3xl px-8 pb-5 pt-7 text-center">
            <input
              aria-label="Kichwa cha Kiswahili"
              value={scoreDetails.swahiliTitle}
              onChange={(event) => updateScoreDetails("swahiliTitle", event.target.value)}
              className="w-full bg-transparent text-center font-display text-4xl font-semibold outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <input
              aria-label="Kichwa cha Kiingereza"
              value={scoreDetails.englishTitle}
              onChange={(event) => updateScoreDetails("englishTitle", event.target.value)}
              className="mt-1 w-full bg-transparent text-center text-base text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="mt-3 flex flex-col items-center gap-1 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-muted-foreground">Arranged by</span>
                <input
                  aria-label="Arranger"
                  value={scoreDetails.arranger}
                  onChange={(event) => updateScoreDetails("arranger", event.target.value)}
                  className="min-w-48 bg-transparent text-center font-medium outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </label>
              <textarea
                aria-label="Maelezo mengine"
                value={scoreDetails.details}
                onChange={(event) => updateScoreDetails("details", event.target.value)}
                placeholder="Andika maelezo mengine hapa"
                rows={2}
                className="w-full resize-none bg-transparent text-center text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
          </section>
          <div ref={container} />
          {activeSyllable !== null && inlinePos && (
            <input
              key={activeSyllable}
              autoFocus
              value={syllables[activeSyllable]?.text ?? ""}
              aria-label="Edit lyric"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(event) => updateSyllable(activeSyllable, event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  const step = e.shiftKey ? -1 : 1;
                  let n = activeSyllable + step;
                  while (n >= 0 && n < syllables.length && !lyricNodes.current[n]) n += step;
                  if (n >= 0 && n < syllables.length) openInline(n);
                  else setActiveSyllable(null);
                } else if (e.key === "Escape") setActiveSyllable(null);
              }}
              onBlur={() => setTimeout(() => setActiveSyllable((a) => (a === activeSyllable ? null : a)), 150)}
              style={{ left: inlinePos.left, top: inlinePos.top, width: inlinePos.width }}
              className="absolute z-10 h-7 border border-primary bg-background px-1 text-center text-sm shadow-md outline-none"
            />
          )}
        </div>
      </div>
    </main>
  );
}
