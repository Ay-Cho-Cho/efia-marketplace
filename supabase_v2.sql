-- EFIA v2 upgrade. Run once in Supabase > SQL Editor (after supabase.sql).

-- 1. Notification consent
alter table profiles add column notify_email boolean default true, add column notify_sms boolean default false;

-- 2. Saved listings and suppliers
create table saved(
  user_id uuid not null default auth.uid() references profiles on delete cascade,
  kind text not null check (kind in ('listing','supplier')),
  target_id uuid not null, created_at timestamptz default now(),
  primary key(user_id,kind,target_id));
alter table saved enable row level security;
create policy s_all on saved for all using (user_id=auth.uid()) with check (user_id=auth.uid());

-- 3. Issue reporting
create table reports(
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null default auth.uid() references profiles,
  listing_id uuid references listings on delete set null,
  request_id uuid references requests on delete set null,
  reason text not null check (reason in ('scam','inaccurate','harassment','dispute','other')),
  details text, status text not null default 'open' check (status in ('open','resolved')),
  admin_note text, created_at timestamptz default now());
alter table reports enable row level security;
create policy rp_ins on reports for insert with check (reporter_id=auth.uid());
create policy rp_sel on reports for select using (reporter_id=auth.uid() or is_admin());
create policy rp_upd on reports for update using (is_admin());

create function log_report() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into notifications(user_id,title,body,link) select id,'Issue reported',initcap(new.reason),'/admin' from profiles where role='admin';
  elsif new.status='resolved' and old.status<>'resolved' then
    insert into audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'report_resolved','report',new.id,jsonb_build_object('note',new.admin_note));
    insert into notifications(user_id,title,body,link) values(new.reporter_id,'Your report was resolved',coalesce(new.admin_note,''),'/');
  end if; return new;
end $$;
create trigger t_log_report after insert or update on reports for each row execute function log_report();

-- 4. Listing expiry notices (daily)
alter table listings add column expiry_warned boolean default false, add column expiry_notified boolean default false;
create function reset_expiry_flags() returns trigger language plpgsql as $$
begin
  if new.expires_at is distinct from old.expires_at then new.expiry_warned:=false; new.expiry_notified:=false; end if;
  return new;
end $$;
create trigger t_reset_expiry before update on listings for each row execute function reset_expiry_flags();

create function run_expiry() returns void language plpgsql security definer set search_path=public as $$
begin
  insert into notifications(user_id,title,body,link) select supplier_id,'Listing expires soon','Reconfirm your '||commodity||' listing before '||to_char(expires_at,'DD Mon'),'/my-listings'
    from listings where status='approved' and expires_at between current_date and current_date+3 and not expiry_warned;
  update listings set expiry_warned=true where status='approved' and expires_at between current_date and current_date+3 and not expiry_warned;
  insert into notifications(user_id,title,body,link) select supplier_id,'Listing expired','Your '||commodity||' listing is hidden from buyers. Reconfirm it to show it again.','/my-listings'
    from listings where status='approved' and expires_at<current_date and not expiry_notified;
  update listings set expiry_notified=true where status='approved' and expires_at<current_date and not expiry_notified;
end $$;
create extension if not exists pg_cron;
select cron.schedule('efia-expiry','0 6 * * *','select run_expiry()');
