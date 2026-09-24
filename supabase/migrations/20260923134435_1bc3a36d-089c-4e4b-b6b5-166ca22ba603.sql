ALTER TABLE public.scores
  ADD COLUMN page_images text[] NOT NULL DEFAULT '{}',
  ADD COLUMN page_xml text[] NOT NULL DEFAULT '{}',
  ADD COLUMN page_count integer NOT NULL DEFAULT 1;