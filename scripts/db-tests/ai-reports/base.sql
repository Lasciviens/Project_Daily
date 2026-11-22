-- What migration 196 (the weekly reports) needs on top of the AI ledger's base (scripts/db-tests/ai-ledger/base.sql,
-- 194 and 195 applied by the runner): pgcrypto in an `extensions` schema (Supabase keeps its hmac there), a Vault
-- whose secret the timers read, and `net.http_post`, which here only writes down what it was asked to send.
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create schema if not exists vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create schema if not exists net;
create table net.sent (n serial primary key, url text, headers jsonb, body jsonb);
create or replace function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb) returns bigint
language sql as $$ insert into net.sent (url, headers, body) values (url, headers, body) returning n::bigint $$;
