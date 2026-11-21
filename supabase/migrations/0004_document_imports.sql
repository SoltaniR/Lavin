alter table documents drop constraint if exists documents_kind_check;
alter table documents add constraint documents_kind_check check (kind in ('pdf','mt940','xml','csv'));

create table if not exists invoice_drafts (
  id uuid primary key,
  business_id uuid not null references businesses(id),
  document_id uuid not null,
  position integer not null,
  direction text check (direction in ('sale','purchase')),
  fields jsonb not null,
  posted_entry uuid,
  dismissed boolean not null default false,
  unique(document_id,position),
  foreign key(document_id,business_id) references documents(id,business_id),
  foreign key(posted_entry,business_id) references entries(id,business_id)
);
create index if not exists invoice_draft_business on invoice_drafts(business_id, document_id);
