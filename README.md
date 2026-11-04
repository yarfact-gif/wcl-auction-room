# WCL Auction Room — Season 1

A Next.js + Supabase multiplayer auction starter that retains the original prototype's dark navy / gold visual language. It uses virtual credits only.

## Important status

This is deployable source code, not a hosted service. It becomes a real multi-device auction only after you create a Supabase project, run `supabase/schema.sql`, configure environment variables, create organiser accounts/room data, enable Realtime and deploy to Vercel.

The original HTML prototype used `localStorage`; this project replaces the single-browser state model with Supabase tables and server-side PostgreSQL RPCs. `place_bid` locks the room row (`FOR UPDATE`) so simultaneous bids are serialized in the database.

## 1. Install tools

Install Node.js 20 LTS and Git. Create a free Supabase account and a free Vercel account.

## 2. Create Supabase project

1. Create a new Supabase project and save its database password.
2. Open **SQL Editor**.
3. Paste and run all of `supabase/schema.sql`.
4. In **Project Settings → API**, copy Project URL and `anon` public key.
5. In **Authentication → Providers → Email**, choose whether email confirmation is enabled.
6. In **Database → Replication / Publications**, enable Realtime for `rooms`, `bids`, `players`, and `squads`.
7. Never put the `service_role` key in browser code.

## 3. Configure the local app

```bash
npm install
cp .env.example .env.local
```

Put your Supabase Project URL and anon key in `.env.local`, then run:

```bash
npm run dev
```

Open http://localhost:3000.

## 4. Create the room and teams

The schema deliberately does not ship a public master password. An organiser must create accounts and provision a private room.

1. Create 11 users in Supabase **Authentication → Users** (one auctioneer and ten owners), or let them register in the app.
2. Copy their Auth user UUIDs.
3. In SQL Editor, run a provisioning script. Replace every placeholder and choose your own strong room/team PINs:

```sql
-- Create the room; room password is hashed automatically.
insert into public.rooms(room_code,password_hash)
values ('WCLS1', crypt('REPLACE_WITH_PRIVATE_ROOM_PASSWORD', gen_salt('bf')))
returning id;
```

Copy the returned room UUID as `ROOM_UUID`. Create the ten teams:

```sql
insert into public.teams(room_id,name,pin_hash)
values
('ROOM_UUID','Trinbago Knight Riders',crypt('TRINBAGO_PIN',gen_salt('bf'))),
('ROOM_UUID','Chennai Super Kings',crypt('CSK_PIN',gen_salt('bf'))),
('ROOM_UUID','Mumbai Indians',crypt('MI_PIN',gen_salt('bf'))),
('ROOM_UUID','Kolkata Knight Riders',crypt('KKR_PIN',gen_salt('bf'))),
('ROOM_UUID','Royal Challengers Bengaluru',crypt('RCB_PIN',gen_salt('bf'))),
('ROOM_UUID','Rajasthan Royals',crypt('RR_PIN',gen_salt('bf'))),
('ROOM_UUID','Sunrisers Hyderabad',crypt('SRH_PIN',gen_salt('bf'))),
('ROOM_UUID','Delhi Capitals',crypt('DC_PIN',gen_salt('bf'))),
('ROOM_UUID','Punjab Kings',crypt('PBKS_PIN',gen_salt('bf'))),
('ROOM_UUID','Gujarat Titans',crypt('GT_PIN',gen_salt('bf')));
```

Then assign each auth user a profile. Replace UUID placeholders with actual Auth user IDs and team IDs:

```sql
insert into public.profiles(id,role,display_name)
values ('AUCTIONEER_AUTH_UUID','auctioneer','WCL Auctioneer');

insert into public.profiles(id,role,team_id,display_name) values
('OWNER_1_AUTH_UUID','owner','TRINBAGO_TEAM_UUID','Trinbago Owner');
-- Repeat for the remaining nine owners and their team UUIDs.
```

Owners enter their own team PIN in the join form. The auctioneer leaves team and team PIN blank. Room membership is only granted by `join_private_room`.

**Provisioning security:** do not share SQL editor access, database credentials, or the Supabase service-role key with participants. Give each person only their account credentials, room code/password and their own team PIN.

## 5. Seed a starter player queue

After room creation, insert player records. Example:

```sql
insert into public.players(room_id,name,country,player_type,role,base_price,queue_position)
values
('ROOM_UUID','Nicholas Pooran','Trinidad and Tobago','Overseas','Wicketkeeper',2,1),
('ROOM_UUID','Abhishek Sharma','India','Indian','Batter',2,2),
('ROOM_UUID','Shubman Gill','India','Indian','Batter',2,3),
('ROOM_UUID','Rajat Patidar','India','Indian','Batter',2,4),
('ROOM_UUID','Heinrich Klaasen','South Africa','Overseas','Wicketkeeper',2,5),
('ROOM_UUID','Marco Jansen','South Africa','Overseas','All-rounder',2,6),
('ROOM_UUID','Mitchell Starc','Australia','Overseas','Bowler',2,7),
('ROOM_UUID','Jasprit Bumrah','India','Indian','Bowler',2,8);
```

Use the actual room UUID, not the literal `ROOM_UUID`.

## 6. Run and deploy

1. Run `npm run build` locally and fix any reported errors.
2. Push the project to a private GitHub repository.
3. In Vercel, **Add New → Project**, import the repository.
4. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` under Environment Variables.
5. Deploy.
6. In Supabase **Authentication → URL Configuration**, add your Vercel URL to Site URL and Redirect URLs.
7. Open the deployed URL on each phone and sign in with each participant account.

## 7. Mobile auction operation

- Keep the auctioneer signed in on one phone/tablet.
- Owners sign in on their own phones and join with their team PIN.
- Start the auction. Owners can submit bids while status is `live`.
- Auctioneer presses WARNING → FINAL WARNING → START 5-4-3-2-1.
- A bid accepted before the countdown deadline clears the warning/countdown and bidding resumes.
- At zero, the database rejects new bids. Auctioneer then marks SOLD or UNSOLD.
- Refreshing the page restores state from Supabase.

## Current implementation coverage

Included in this starter:
- Supabase Auth sign-in and account registration.
- Room-code/password join plus per-team PIN.
- Database roles and auctioneer-only RPCs.
- Ten team schema and ₹150 Cr starting purse.
- Atomic, server-validated bids and increment rules.
- Warning → final warning → five-second database timestamp countdown.
- Accepted bid history and Realtime subscriptions.
- SOLD/UNSOLD, player queue insertion, team purse/squad summary, CSV export.
- Responsive dark navy / gold interface.
- Virtual credits only.

Still required before calling it a complete production auction:
- Complete UI for editing/removing/reordering players and CSV import.
- Admin correction/undo, mute/disqualify and audit-safe reversal workflows.
- Squad minimum enforcement at auction close and Playing XI selection validation.
- Admin room creation/provisioning screen and invite management.
- Automated integration tests, load testing, and security review.
- A robust client connection indicator/reconnect UX and server-side countdown finalization job.

The schema enforces the maximum squad size, overseas squad limit, purse, bid increments and auctioneer role on privileged RPCs. It does not yet enforce the minimum squad size at the moment the auction is ended, because that should be a deliberate organiser-approved completion check rather than blocking a live auction midway.

## Troubleshooting

- **No room access:** verify that the profile row exists, room code/password are correct, and the account has not already joined a different room.
- **Team PIN rejected:** check the correct team UUID and PIN hash.
- **Realtime not updating:** enable the four tables in Supabase Realtime publication and check browser console/network.
- **Email confirmation:** if enabled, verify the email before signing in.
- **Build environment error:** make sure `.env.local` contains the Supabase URL and anon key.

## Security note

This is a foundation, not a security-audited production system. Before a high-stakes event, test with dummy accounts, review RLS policies and RPC grants, add the remaining admin workflows, and perform a second-device concurrency test. All credits are simulated and have no monetary value.
