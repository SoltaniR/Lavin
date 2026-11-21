create table if not exists invoice_date_rules (
  supplier_key text primary key,
  date_label text not null check (date_label in ('created','creation date','aangemaakt','olusturma tarihi'))
);
