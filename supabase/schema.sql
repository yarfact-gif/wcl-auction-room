-- WCL AUCTION ROOM — run in Supabase SQL Editor.
create extension if not exists pgcrypto;

create type public.member_role as enum ('auctioneer','owner');
create type public.auction_status as enum ('draft','live','paused','ended');
create type public.player_status as enum ('upcoming','current','sold','unsold');

create table public.rooms (
 id uuid primary key default gen_random_uuid(),
 name text not null default 'WCL AUCTION ROOM — SEASON 1',
 room_code text not null unique,
 password_hash text not null,
 status public.auction_status not null default 'draft',
 current_player_id uuid,
 current_bid numeric(6,1) not null default 0,
 leading_team_id uuid,
 warning_stage int not null default 0 check (warning_stage between 0 and 3),
 countdown_ends_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.teams (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references rooms on delete cascade,
 name text not null,
 purse_remaining numeric(7,1) not null default 150 check(purse_remaining >= 0),
 pin_hash text not null,
 unique(room_id,name)
);
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 role public.member_role not null default 'owner',
 team_id uuid references teams,
 display_name text
);
create table public.room_members (
 room_id uuid references rooms on delete cascade,
 user_id uuid references auth.users on delete cascade,
 joined_at timestamptz not null default now(),
 primary key(room_id,user_id)
);
create table public.players (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references rooms on delete cascade,
 name text not null,
 country text not null default 'India',
 player_type text not null default 'Indian' check(player_type in ('Indian','Overseas')),
 role text not null,
 batting_style text default '',
 bowling_style text default '',
 base_price numeric(6,1) not null default 2 check(base_price >= 2),
 image_url text,
 status public.player_status not null default 'upcoming',
 queue_position int not null default 0,
 created_at timestamptz not null default now()
);
alter table rooms add constraint rooms_current_player_fk foreign key(current_player_id) references players(id) deferrable initially deferred;
alter table rooms add constraint rooms_leading_team_fk foreign key(leading_team_id) references teams(id) deferrable initially deferred;
create table public.bids (
 id bigint generated always as identity primary key,
 room_id uuid not null references rooms on delete cascade,
 player_id uuid not null references players,
 team_id uuid not null references teams,
 user_id uuid not null references auth.users,
 amount numeric(6,1) not null,
 created_at timestamptz not null default now()
);
create index bids_room_created on bids(room_id,created_at desc);
create table public.squads (
 id bigint generated always as identity primary key,
 room_id uuid not null references rooms on delete cascade,
 team_id uuid not null references teams,
 player_id uuid not null references players,
 price numeric(6,1) not null,
 unique(room_id,player_id)
);
create table public.auction_events (
 id bigint generated always as identity primary key,
 room_id uuid not null references rooms on delete cascade,
 actor_id uuid references auth.users,
 event_type text not null,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);

create view public.team_public_state with (security_invoker=true) as
select t.id,t.room_id,t.name,t.purse_remaining,
 count(s.id)::int as squad_count,
 count(s.id) filter(where p.player_type='Overseas')::int as overseas_count
from teams t left join squads s on s.team_id=t.id
left join players p on p.id=s.player_id
group by t.id;

create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from room_members where room_id=p_room and user_id=auth.uid()) $$;
create or replace function public.is_auctioneer(p_room uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from room_members m join profiles p on p.id=m.user_id where m.room_id=p_room and m.user_id=auth.uid() and p.role='auctioneer') $$;

-- Room and team PINs are hashed in the database. Never expose hashes to clients.
create or replace function public.join_private_room(p_room_code text,p_room_password text,p_team_name text default null,p_team_pin text default null)
returns void language plpgsql security definer set search_path=public
as $$
declare r rooms; t teams; existing profiles;
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 select * into r from rooms where room_code=upper(p_room_code);
 if not found or r.password_hash <> crypt(p_room_password,r.password_hash) then raise exception 'Invalid room code or password'; end if;
 select * into existing from profiles where id=auth.uid();
 if not found then raise exception 'Ask the organiser to assign your role and team before joining'; end if;
 if existing.role='auctioneer' then
   if p_team_name is not null and p_team_name <> '' then raise exception 'Auctioneer must not select a team'; end if;
 else
   if p_team_name is null or p_team_name = '' then raise exception 'Choose your assigned team'; end if;
   select * into t from teams where name=p_team_name and room_id=r.id;
   if not found or t.pin_hash <> crypt(coalesce(p_team_pin,''),t.pin_hash) then raise exception 'Invalid team or team PIN'; end if;
   update profiles set team_id=t.id where id=auth.uid();
 end if;
 insert into room_members(room_id,user_id) values(r.id,auth.uid()) on conflict do nothing;
end $$;

-- All bids serialize on the room row. Two simultaneous requests cannot both win the same price.
create or replace function public.place_bid(p_room_id uuid)
returns numeric language plpgsql security definer set search_path=public
as $$
declare r rooms; p players; t teams; pr profiles; v numeric(6,1); overseas_count int; squad_count int;
begin
 select * into r from rooms where id=p_room_id for update;
 if not found or not is_room_member(p_room_id) then raise exception 'Not a member of this room'; end if;
 if r.status <> 'live' then raise exception 'Bidding is not open'; end if;
 if r.countdown_ends_at is not null and r.countdown_ends_at <= now() then raise exception 'Countdown ended; bidding is closed'; end if;
 select * into pr from profiles where id=auth.uid();
 if pr.role <> 'owner' or pr.team_id is null then raise exception 'Only team owners can bid'; end if;
 select * into p from players where id=r.current_player_id and status='current';
 if not found then raise exception 'No active player'; end if;
 select * into t from teams where id=pr.team_id for update;
 select count(*) into squad_count from squads where team_id=t.id;
 select count(*) into overseas_count from squads s join players x on x.id=s.player_id where s.team_id=t.id and x.player_type='Overseas';
 if squad_count >= 18 then raise exception 'Squad is full'; end if;
 if p.player_type='Overseas' and overseas_count >= 8 then raise exception 'Overseas limit reached'; end if;
 v := case when r.current_bid=0 then p.base_price else r.current_bid + case when r.current_bid < 5 then 0.2 else 0.5 end end;
 v := round(v,1);
 if t.purse_remaining < v then raise exception 'Insufficient purse'; end if;
 update rooms set current_bid=v,leading_team_id=t.id,warning_stage=0,countdown_ends_at=null where id=r.id;
 insert into bids(room_id,player_id,team_id,user_id,amount) values(r.id,p.id,t.id,auth.uid(),v);
 insert into auction_events(room_id,actor_id,event_type,payload) values(r.id,auth.uid(),'BID',jsonb_build_object('player',p.name,'team',t.name,'amount',v));
 return v;
end $$;

create or replace function public.auction_start(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$
declare p players;
begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set status='live' where id=p_room_id and status in ('draft','paused');
 select * into p from players where room_id=p_room_id and status='upcoming' order by queue_position limit 1;
 if p.id is not null then update players set status='current' where id=p.id; update rooms set current_player_id=p.id,current_bid=0,leading_team_id=null,warning_stage=0,countdown_ends_at=null where id=p_room_id; end if;
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'AUCTION_START');
end $$;
create or replace function public.auction_pause(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set status='paused',countdown_ends_at=null where id=p_room_id;
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'PAUSE');
end $$;
create or replace function public.auction_resume(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set status='live' where id=p_room_id and status='paused';
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'RESUME');
end $$;
create or replace function public.auction_end(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set status='ended',countdown_ends_at=null where id=p_room_id;
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'END');
end $$;
create or replace function public.auction_warning(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set warning_stage=1,countdown_ends_at=null where id=p_room_id and status='live';
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'WARNING');
end $$;
create or replace function public.auction_final_warning(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set warning_stage=2,countdown_ends_at=null where id=p_room_id and status='live' and warning_stage=1;
 if not found then raise exception 'Issue WARNING first'; end if;
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'FINAL_WARNING');
end $$;
create or replace function public.auction_countdown(p_room_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 update rooms set warning_stage=3,countdown_ends_at=now()+interval '5 seconds' where id=p_room_id and status='live' and warning_stage=2;
 if not found then raise exception 'Issue WARNING and FINAL WARNING first'; end if;
 insert into auction_events(room_id,actor_id,event_type) values(p_room_id,auth.uid(),'COUNTDOWN');
end $$;

create or replace function public.finish_player(p_room_id uuid,p_sold boolean) returns void language plpgsql security definer set search_path=public as $$
declare r rooms; p players; t teams;
begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 select * into r from rooms where id=p_room_id for update;
 if r.warning_stage <> 3 or r.countdown_ends_at is null then raise exception 'Complete WARNING, FINAL WARNING and countdown first'; end if;
 if r.countdown_ends_at > now() then raise exception 'Countdown is still running'; end if;
 select * into p from players where id=r.current_player_id and status='current';
 if not found then raise exception 'No current player'; end if;
 if p_sold then
   if r.leading_team_id is null or r.current_bid<=0 then raise exception 'No valid bid to sell'; end if;
   select * into t from teams where id=r.leading_team_id for update;
   if t.purse_remaining < r.current_bid then raise exception 'Winning team purse changed'; end if;
   update teams set purse_remaining=purse_remaining-r.current_bid where id=t.id;
   insert into squads(room_id,team_id,player_id,price) values(r.id,t.id,p.id,r.current_bid);
   update players set status='sold' where id=p.id;
 else update players set status='unsold' where id=p.id;
 end if;
 insert into auction_events(room_id,actor_id,event_type,payload) values(r.id,auth.uid(),case when p_sold then 'SOLD' else 'UNSOLD' end,jsonb_build_object('player',p.name,'price',r.current_bid));
 update rooms set current_player_id=null,current_bid=0,leading_team_id=null,warning_stage=0,countdown_ends_at=null where id=r.id;
end $$;

create or replace function public.admin_add_player(p_room_id uuid,p_name text,p_country text,p_role text,p_batting_style text,p_bowling_style text,p_base_price numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare new_id uuid;
begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 insert into players(room_id,name,country,player_type,role,batting_style,bowling_style,base_price,queue_position)
 values(p_room_id,p_name,p_country,case when lower(p_country) in ('india','indian') then 'Indian' else 'Overseas' end,p_role,p_batting_style,p_bowling_style,p_base_price,
 (select coalesce(max(queue_position),0)+1 from players where room_id=p_room_id)) returning id into new_id;
 insert into auction_events(room_id,actor_id,event_type,payload) values(p_room_id,auth.uid(),'PLAYER_ADDED',jsonb_build_object('player',p_name));
 return new_id;
end $$;


create or replace function public.auction_mark_sold(p_room_id uuid) returns void
language sql security definer set search_path=public
as $$ select public.finish_player(p_room_id,true) $$;
create or replace function public.auction_mark_unsold(p_room_id uuid) returns void
language sql security definer set search_path=public
as $$ select public.finish_player(p_room_id,false) $$;

create or replace function public.auction_next_player(p_room_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare r rooms; p players;
begin
 if not is_auctioneer(p_room_id) then raise exception 'Auctioneer only'; end if;
 select * into r from rooms where id=p_room_id for update;
 if r.status <> 'live' then raise exception 'Auction must be live'; end if;
 if r.current_player_id is not null then raise exception 'Mark the current player SOLD or UNSOLD first'; end if;
 select * into p from players where room_id=p_room_id and status='upcoming' order by queue_position limit 1;
 if p.id is null then raise exception 'No upcoming players remain'; end if;
 update players set status='current' where id=p.id;
 update rooms set current_player_id=p.id,current_bid=0,leading_team_id=null,warning_stage=0,countdown_ends_at=null where id=p_room_id;
 insert into auction_events(room_id,actor_id,event_type,payload) values(p_room_id,auth.uid(),'NEXT_PLAYER',jsonb_build_object('player',p.name));
end $$;

alter table rooms enable row level security;
alter table teams enable row level security;
alter table profiles enable row level security;
alter table room_members enable row level security;
alter table players enable row level security;
alter table bids enable row level security;
alter table squads enable row level security;
alter table auction_events enable row level security;

create policy "members read room" on rooms for select using (is_room_member(id));
create policy "members read teams" on teams for select using (is_room_member(room_id));
create policy "self profile read" on profiles for select using (id=auth.uid());
create policy "members read players" on players for select using (is_room_member(room_id));
create policy "members read bids" on bids for select using (is_room_member(room_id));
create policy "members read squads" on squads for select using (is_room_member(room_id));
create policy "members read events" on auction_events for select using (is_room_member(room_id));
create policy "members read membership" on room_members for select using (user_id=auth.uid());

grant select on public.team_public_state to authenticated;
grant execute on function public.join_private_room(text,text,text,text) to authenticated;
grant execute on function public.place_bid(uuid) to authenticated;
grant execute on function public.auction_start(uuid),public.auction_pause(uuid),public.auction_resume(uuid),public.auction_end(uuid),public.auction_warning(uuid),public.auction_final_warning(uuid),public.auction_countdown(uuid),public.finish_player(uuid,boolean),public.auction_mark_sold(uuid),public.auction_mark_unsold(uuid),public.auction_next_player(uuid),public.admin_add_player(uuid,text,text,text,text,text,numeric) to authenticated;

-- Add tables to Realtime in Supabase Dashboard > Database > Publications if not already enabled.
