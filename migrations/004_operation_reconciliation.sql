ALTER TABLE plugin_llm_wiki_8f50da974f.wiki_operations
  ADD COLUMN IF NOT EXISTS event_cost_cents integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS plugin_llm_wiki_8f50da974f.wiki_operation_events (
  event_id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES plugin_llm_wiki_8f50da974f.wiki_operations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  cost_cents integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wiki_operation_events_operation_idx
  ON plugin_llm_wiki_8f50da974f.wiki_operation_events (company_id, operation_id, created_at);
