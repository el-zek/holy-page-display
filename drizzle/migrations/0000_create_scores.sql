CREATE TABLE public.scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL DEFAULT 'score.pdf',
  original_musicxml TEXT NOT NULL DEFAULT '',
  edited_musicxml TEXT,
  warnings TEXT,
  page_xml TEXT[] NOT NULL DEFAULT '{}',
  page_images TEXT[] NOT NULL DEFAULT '{}',
  page_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scores TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scores TO authenticated;
GRANT ALL ON public.scores TO service_role;

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scores" ON public.scores FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can create scores" ON public.scores FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can update scores" ON public.scores FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete scores" ON public.scores FOR DELETE TO anon, authenticated USING (true);