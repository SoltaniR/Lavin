create table if not exists businesses (
  id uuid primary key, profile jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists accounts (
  code text primary key, kind text not null check (kind in ('asset','liability','equity','income','expense'))
);
create table if not exists documents (
  id uuid primary key, business_id uuid not null references businesses(id),
  name text not null, kind text not null check (kind in ('pdf','mt940')),
  status text not null, sha256 text not null, text_content text not null default '',
  metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  unique (business_id, sha256), unique (id, business_id)
);
create table if not exists entries (
  id uuid primary key, business_id uuid not null references businesses(id),
  entry_date date not null, description text not null, kind text not null,
  request_key uuid not null, source_id uuid,
  created_at timestamptz not null default now(),
  unique (business_id, request_key), unique (id,business_id),
  foreign key (source_id,business_id) references documents(id,business_id)
);
create table if not exists lines (
  id bigint generated always as identity primary key,
  entry_id uuid not null, business_id uuid not null,
  account text not null references accounts(code),
  debit numeric(14,2) not null default 0, credit numeric(14,2) not null default 0,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0)),
  foreign key (entry_id,business_id) references entries(id,business_id)
);
create table if not exists bank_rows (
  id uuid primary key, business_id uuid not null,
  document_id uuid not null, booking_date date not null,
  amount numeric(14,2) not null, description text not null, reference text not null,
  posted_entry uuid, position integer not null,
  unique(document_id,position),
  foreign key(document_id,business_id) references documents(id,business_id),
  foreign key(posted_entry,business_id) references entries(id,business_id)
);
create table if not exists evidence (
  business_id uuid not null references businesses(id), requirement text not null,
  note text not null check(length(note) >= 5), updated_at timestamptz not null default now(),
  primary key (business_id,requirement)
);
create index if not exists entry_business_date on entries(business_id,entry_date,id);
create index if not exists line_business on lines(business_id,entry_id);
create index if not exists document_business on documents(business_id,created_at);
create index if not exists bank_business on bank_rows(business_id,booking_date);

-- Atomic posting boundary. App exposes no general SQL endpoint.
create or replace function post_entry(
  p_id uuid, p_business uuid, p_date date, p_description text,
  p_kind text, p_key uuid, p_source uuid, p_lines jsonb
) returns uuid language plpgsql as $$
declare existing uuid; fiscal_year integer; line jsonb; total numeric := 0;
begin
  select (profile->>'year')::integer into fiscal_year from businesses where id=p_business;
  if fiscal_year is null or extract(year from p_date) <> fiscal_year then raise exception 'date'; end if;
  if p_kind not in ('sale','purchase','payment','opening','adjustment') or length(trim(p_description)) < 3 then raise exception 'entry'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'balance'; end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if not exists(select 1 from accounts where code=line->>'account') then raise exception 'account'; end if;
    if p_kind='opening' and exists(select 1 from accounts where code=line->>'account' and kind in ('income','expense')) then raise exception 'opening'; end if;
    if line->>'debit' is null or line->>'credit' is null
      or (line->>'debit') !~ '^\d+(\.\d{1,2})?$' or (line->>'credit') !~ '^\d+(\.\d{1,2})?$'
      or not (((line->>'debit')::numeric > 0 and (line->>'credit')::numeric = 0)
        or ((line->>'credit')::numeric > 0 and (line->>'debit')::numeric = 0)) then raise exception 'amount'; end if;
    total := total + (line->>'debit')::numeric - (line->>'credit')::numeric;
  end loop;
  if total <> 0 then raise exception 'balance'; end if;
  insert into entries(id,business_id,entry_date,description,kind,request_key,source_id)
    values(p_id,p_business,p_date,p_description,p_kind,p_key,p_source)
    on conflict(business_id,request_key) do nothing returning id into existing;
  if existing is null then
    select id into existing from entries where business_id=p_business and request_key=p_key;
    -- Retries must be exactly the same entry, not silently overwrite a reused key.
    if not exists(select 1 from entries where id=existing and entry_date=p_date and description=p_description
      and kind=p_kind and source_id is not distinct from p_source)
      or (select jsonb_agg(jsonb_build_object('account',account,'debit',debit::text,'credit',credit::text) order by id) from lines where entry_id=existing) <> p_lines
    then raise exception 'duplicateKey'; end if;
    return existing;
  end if;
  insert into lines(entry_id,business_id,account,debit,credit)
    select p_id,p_business,value->>'account',(value->>'debit')::numeric,(value->>'credit')::numeric from jsonb_array_elements(p_lines);
  return p_id;
end $$;

-- Hosted auth/RLS is deliberately not claimed here. This migration currently
-- serves a loopback-only development workspace, not an exposed Supabase API.
-- Deny public function execution; the local database owner invokes it.
revoke all on function post_entry(uuid,uuid,date,text,text,uuid,uuid,jsonb) from public;
