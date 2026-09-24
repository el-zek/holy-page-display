CREATE TABLE public.scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  original_musicxml TEXT NOT NULL,
  edited_musicxml TEXT,
  warnings TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.scores TO anon;
GRANT SELECT, INSERT, UPDATE ON public.scores TO authenticated;
GRANT ALL ON public.scores TO service_role;

ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scores" ON public.scores FOR SELECT USING (true);
CREATE POLICY "Anyone can create scores" ON public.scores FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update scores" ON public.scores FOR UPDATE USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_scores_updated_at BEFORE UPDATE ON public.scores
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();