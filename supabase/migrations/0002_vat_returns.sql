-- A transcription of the original filed return. Corrections remain separate
-- documents. The business already identifies a single financial year.
create table if not exists vat_returns (
  business_id uuid not null references businesses(id),
  quarter smallint not null check (quarter between 1 and 4),
  source_id uuid not null,
  filed_output bigint not null check (filed_output between -9999999999 and 9999999999),
  filed_input bigint not null check (filed_input between -9999999999 and 9999999999),
  note text not null default '' check (length(note) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (business_id, quarter),
  foreign key (source_id, business_id) references documents(id, business_id)
);
create index if not exists vat_return_source on vat_returns(source_id, business_id);
revoke all on vat_returns from public;
