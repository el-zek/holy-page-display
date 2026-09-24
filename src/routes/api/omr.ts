import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const inputSchema = z.object({
  filename: z.string().min(1).max(200),
  image: z.string().startsWith("data:image/").max(8_000_000),
  pageNumber: z.number().int().min(1).max(50),
  totalPages: z.number().int().min(1).max(50),
  context: z
    .object({
      partList: z.string().max(20_000),
      firstMeasure: z.number().int().min(1),
      lastAttributes: z.string().max(20_000),
    })
    .optional(),
});

const SYSTEM_PROMPT = `You are an optical music recognition engine.
You receive images of printed sheet music pages (often SATB choir music).
Return ONE complete, valid MusicXML 3.1 score-partwise document that reproduces
what is printed, as faithfully as you can.

Rules:
- Output ONLY the XML. No markdown fences, no commentary.
- Start with <?xml version="1.0" encoding="UTF-8"?> and a score-partwise root.
- Include a part-list with one score-part per printed staff/voice
  (e.g. Soprano, Alto, Tenor, Bass) using their printed names.
- Preserve clefs, key signatures, time signatures, measure structure, note
  pitches, durations, rests, ties, slurs and dynamics where legible.
- Attach lyrics with <lyric number="1"><syllabic>..</syllabic><text>..</text></lyric>
  on the notes that carry them, using single/begin/middle/end syllabic values.
- You transcribe ONE page at a time. When context from the previous page is given,
  reuse exactly the same part-list (same part ids, names and order), start measure
  numbering at the given number, and keep the key/time/clefs in force unless the
  page changes them.
- The page may carry watermarks, stamps, logos or background text (e.g. website
  names, "preview", "sample"). Ignore them completely: never read them as notes,
  lyrics, titles, dynamics or text. Transcribe only the printed music.
- If part of a page is illegible, still produce valid measures for what you can read.`;

export const Route = createFileRoute("/api/omr")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return new Response("AI conversion is not configured.", { status: 500 });

        let data: z.infer<typeof inputSchema>;
        try {
          data = inputSchema.parse(await request.json());
        } catch {
          return new Response("Invalid page data.", { status: 400 });
        }

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          signal: request.signal,
          body: JSON.stringify({
            model: "google/gemini-3.1-pro-preview",
            stream: true,
            reasoning: { effort: "low" },
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      `Transcribe page ${data.pageNumber} of ${data.totalPages} of "${data.filename}" into one MusicXML document.` +
                      (data.context
                        ? `\n\nThis continues the previous page. Start measure numbers at ${data.context.firstMeasure}.` +
                          `\nUse exactly this part-list:\n${data.context.partList}` +
                          `\nAttributes in force at the end of the previous page (per part):\n${data.context.lastAttributes}`
                        : ""),
                  },
                  { type: "image_url", image_url: { url: data.image } },
                ],
              },
            ],
          }),
        });

        if (!upstream.ok || !upstream.body) {
          const msg =
            upstream.status === 429
              ? "Too many conversions right now. Please try again in a moment."
              : upstream.status === 402
                ? "AI credits are exhausted. Please top up to keep converting."
                : `Recognition failed (${upstream.status}). Please try again.`;
          return new Response(msg, { status: upstream.status || 500 });
        }

        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();

        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            // Heartbeat whitespace keeps the connection alive while the model thinks.
            const beat = setInterval(() => controller.enqueue(encoder.encode(" ")), 10_000);
            let buffer = "";
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                  const t = line.trim();
                  if (!t.startsWith("data:")) continue;
                  const payload = t.slice(5).trim();
                  if (payload === "[DONE]") continue;
                  try {
                    const json = JSON.parse(payload) as {
                      choices?: Array<{ delta?: { content?: string } }>;
                    };
                    const text = json.choices?.[0]?.delta?.content;
                    if (text) controller.enqueue(encoder.encode(text));
                  } catch {
                    /* partial/non-JSON frame */
                  }
                }
              }
              controller.close();
            } catch (e) {
              controller.error(e);
            } finally {
              clearInterval(beat);
            }
          },
          cancel(reason) {
            return reader.cancel(reason);
          },
        });

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        });
      },
    },
  },
});
