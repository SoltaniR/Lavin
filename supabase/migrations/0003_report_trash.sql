-- Preserve the report and all linked bookkeeping when it is moved to Trash.
alter table businesses add column if not exists trashed_at timestamptz;
