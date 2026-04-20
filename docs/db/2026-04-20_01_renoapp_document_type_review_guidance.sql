alter table public.renovation_document_types
  add column if not exists review_guidance text;
