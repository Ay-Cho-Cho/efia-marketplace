-- EFIA Marketplace schema. Paste into Supabase > SQL Editor > Run (once).

create table profiles(
  id uuid primary key references auth.users on delete cascade,
  role text not null default 'buyer' check (role in ('supplier','buyer','admin')),
  contact_name text, phone text, email text, org_name text, kind text,
  state text, lga text, town text, commodities text[] default '{}',
  verification text not null default 'pending' check (verification in ('pending','verified','needs_review','rejected')),
  created_at timestamptz default now());

create table listings(
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references profiles on delete cascade,
  commodity text not null check (commodity in ('cassava','pepper')),
  variety text, quantity numeric check (quantity>0),
  unit text not null default 'tonnes' check (unit in ('kg','tonnes','bags')),
  bag_kg numeric,
  quantity_kg numeric generated always as (quantity * case unit when 'kg' then 1 when 'tonnes' then 1000 else coalesce(bag_kg,0) end) stored,
  state text, lga text, town text,
  availability text not null default 'available_now' check (availability in ('available_now','expected_harvest','unavailable')),
  available_date date, price numeric, price_unit text check (price_unit in ('kg','tonne','bag')),
  quality text, min_order text, delivery text,
  expires_at date not null default (current_date+30),
  status text not null default 'draft' check (status in ('draft','submitted','under_review','approved','rejected','paused','unavailable')),
  review_note text, reviewed_by uuid references profiles, reviewed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now());
create index on listings(status,expires_at);

create table requests(
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings on delete set null,
  listing_title text,
  buyer_id uuid not null references profiles, supplier_id uuid not null references profiles,
  kind text not null default 'enquiry' check (kind in ('enquiry','purchase_request')),
  quantity numeric, unit text, delivery_location text, needed_by date, message text,
  status text not null default 'submitted' check (status in ('submitted','received','in_discussion','offer_made','agreed','in_fulfilment','completed','cancelled','disputed')),
  agreed_terms text, outcome_note text, admin_note text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table messages(
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests on delete cascade,
  sender_id uuid not null default auth.uid() references profiles,
  body text not null, created_at timestamptz default now());

create table notifications(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  title text, body text, link text, read boolean default false, created_at timestamptz default now());

create table audit_log(
  id bigint generated always as identity primary key,
  actor uuid, action text, entity text, entity_id uuid, detail jsonb, created_at timestamptz default now());

-- helpers
create function is_admin() returns boolean language sql security definer stable set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;

-- public-safe view of suppliers/buyers (no phone/email)
create view party_public as
  select id, role, coalesce(nullif(org_name,''), contact_name) as name, kind, state, lga, verification
  from profiles where role in ('supplier','buyer');
grant select on party_public to authenticated;

-- new user -> profile (role limited to supplier/buyer; admin is granted manually)
create function handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into profiles(id,role,contact_name,phone,email) values(new.id,
    case when new.raw_user_meta_data->>'role' in ('supplier','buyer') then new.raw_user_meta_data->>'role' else 'buyer' end,
    new.raw_user_meta_data->>'contact_name', new.raw_user_meta_data->>'phone', new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- profiles: users cannot change their own role or verification
create function guard_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and not is_admin() then new.role:=old.role; new.verification:=old.verification; end if;
  return new;
end $$;
create trigger t_guard_profile before update on profiles for each row execute function guard_profile();

create function log_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.verification is distinct from old.verification then
    insert into audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'profile_verification','profile',new.id,jsonb_build_object('from',old.verification,'to',new.verification));
    insert into notifications(user_id,title,body,link) values(new.id,'Account '||replace(new.verification,'_',' '),'EFIA updated your account verification status.','/profile');
  end if; return new;
end $$;
create trigger t_log_profile after update on profiles for each row execute function log_profile();

-- listings: lifecycle rules + audit + notifications
create function guard_listing() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if tg_op='INSERT' or new.status is distinct from old.status then
      if new.status not in ('draft','submitted','paused','unavailable') then raise exception 'Only EFIA admins can set status %', new.status; end if;
    end if;
    if tg_op='UPDATE' then
      new.supplier_id:=old.supplier_id; new.review_note:=old.review_note; new.reviewed_by:=old.reviewed_by; new.reviewed_at:=old.reviewed_at;
      -- material change to an approved listing -> back to review
      if old.status='approved' and new.status='approved' and
        (new.commodity,new.quantity,new.unit,new.bag_kg,new.state,new.lga,new.availability) is distinct from
        (old.commodity,old.quantity,old.unit,old.bag_kg,old.state,old.lga,old.availability) then new.status:='submitted'; end if;
    end if;
  end if;
  if new.status='submitted' and new.quantity is null then raise exception 'Quantity is required'; end if;
  new.updated_at:=now(); return new;
end $$;
create trigger t_guard_listing before insert or update on listings for each row execute function guard_listing();

create function log_listing() returns trigger language plpgsql security definer set search_path=public as $$
declare o text;
begin
  if tg_op='UPDATE' then o:=old.status; end if;
  if o is distinct from new.status then
    insert into audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'listing_'||new.status,'listing',new.id,jsonb_build_object('from',o,'note',new.review_note));
    if is_admin() then
      insert into notifications(user_id,title,body,link) values(new.supplier_id,'Listing '||replace(new.status,'_',' '),coalesce(new.review_note,'EFIA updated your listing.'),'/my-listings');
    elsif new.status='submitted' then
      insert into notifications(user_id,title,body,link) select id,'Listing awaiting review',initcap(new.commodity)||' listing submitted','/admin' from profiles where role='admin';
    end if;
  end if; return new;
end $$;
create trigger t_log_listing after insert or update on listings for each row execute function log_listing();

-- requests
create function guard_request() returns trigger language plpgsql security definer set search_path=public as $$
declare l listings;
begin
  if tg_op='INSERT' then
    select * into l from listings where id=new.listing_id and status='approved' and expires_at>=current_date and availability<>'unavailable';
    if not found then raise exception 'This listing is no longer available'; end if;
    new.buyer_id:=auth.uid(); new.supplier_id:=l.supplier_id; new.status:='submitted';
    new.listing_title:=initcap(l.commodity)||', '||l.quantity||' '||l.unit||', '||l.town||', '||l.state;
  else
    new.buyer_id:=old.buyer_id; new.supplier_id:=old.supplier_id; new.listing_id:=old.listing_id; new.listing_title:=old.listing_title;
    if not is_admin() then new.admin_note:=old.admin_note; end if;
  end if;
  new.updated_at:=now(); return new;
end $$;
create trigger t_guard_request before insert or update on requests for each row execute function guard_request();

create function log_request() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if tg_op='INSERT' then
    insert into notifications(user_id,title,body,link) values(new.supplier_id,'New buyer request',new.listing_title,'/requests/'||new.id);
    insert into audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'request_submitted','request',new.id,'{}');
  elsif new.status is distinct from old.status then
    insert into audit_log(actor,action,entity,entity_id,detail) values(auth.uid(),'request_'||new.status,'request',new.id,jsonb_build_object('from',old.status,'note',new.outcome_note));
    if auth.uid() is distinct from new.buyer_id then insert into notifications(user_id,title,body,link) values(new.buyer_id,'Request '||replace(new.status,'_',' '),new.listing_title,'/requests/'||new.id); end if;
    if auth.uid() is distinct from new.supplier_id then insert into notifications(user_id,title,body,link) values(new.supplier_id,'Request '||replace(new.status,'_',' '),new.listing_title,'/requests/'||new.id); end if;
    if new.status='disputed' then insert into notifications(user_id,title,body,link) select id,'Issue reported',new.listing_title,'/requests/'||new.id from profiles where role='admin'; end if;
  end if; return new;
end $$;
create trigger t_log_request after insert or update on requests for each row execute function log_request();

create function log_message() returns trigger language plpgsql security definer set search_path=public as $$
declare r requests;
begin
  select * into r from requests where id=new.request_id;
  insert into notifications(user_id,title,body,link) select t.u,'New message',left(new.body,80),'/requests/'||r.id from unnest(array[r.buyer_id,r.supplier_id]) as t(u) where t.u<>new.sender_id;
  return new;
end $$;
create trigger t_log_message after insert on messages for each row execute function log_message();

-- Row Level Security
alter table profiles enable row level security;
alter table listings enable row level security;
alter table requests enable row level security;
alter table messages enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

create policy p_sel on profiles for select using (id=auth.uid() or is_admin());
create policy p_upd on profiles for update using (id=auth.uid() or is_admin());

create policy l_sel on listings for select using (supplier_id=auth.uid() or is_admin() or (status='approved' and expires_at>=current_date and availability<>'unavailable'));
create policy l_ins on listings for insert with check (supplier_id=auth.uid() and exists(select 1 from profiles where id=auth.uid() and role='supplier'));
create policy l_upd on listings for update using (supplier_id=auth.uid() or is_admin());
create policy l_del on listings for delete using (supplier_id=auth.uid() and status='draft');

create policy r_sel on requests for select using (buyer_id=auth.uid() or supplier_id=auth.uid() or is_admin());
create policy r_ins on requests for insert with check (buyer_id=auth.uid() and exists(select 1 from profiles where id=auth.uid() and role='buyer'));
create policy r_upd on requests for update using (buyer_id=auth.uid() or supplier_id=auth.uid() or is_admin());

create policy m_sel on messages for select using (exists(select 1 from requests where id=request_id));
create policy m_ins on messages for insert with check (sender_id=auth.uid() and exists(select 1 from requests where id=request_id));

create policy n_sel on notifications for select using (user_id=auth.uid());
create policy n_upd on notifications for update using (user_id=auth.uid());

create policy a_sel on audit_log for select using (is_admin());

-- After you register your own account in the app, make it an admin:
-- update profiles set role='admin' where email='YOUR-EMAIL';
