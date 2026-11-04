"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

type Team = { id: string; name: string; purse_remaining: number; squad_count: number; overseas_count: number };
type Player = { id: string; name: string; country: string; player_type: string; role: string; batting_style: string; bowling_style: string; base_price: number; status: string; image_url?: string | null };
type RoomState = { id: string; status: string; current_player_id: string | null; current_bid: number; leading_team_id: string | null; warning_stage: number; countdown_ends_at: string | null };
type Profile = { role: string; team_id: string | null; display_name: string | null };

const money = (n: number) => `₹${Number(n || 0).toFixed(1)} Cr`;

export default function Home() {
  const db = useMemo(() => supabaseBrowser(), []);
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [roomPassword, setRoomPassword] = useState("");
  const [teamPin, setTeamPin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [teamId, setTeamId] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [nextBid, setNextBid] = useState(2.2);
  const [clock, setClock] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newPlayer, setNewPlayer] = useState({ name: "", country: "India", role: "Batter", batting: "", bowling: "", base: "2" });
      const refresh = useCallback(async () => {
    const { data: auth } = await db.auth.getSession();
    if (!auth.session) return;
    
    const { data: prof } = await db.from("profiles").select("role,team_id,display_name").eq("id", auth.session.user.id).maybeSingle();
    if (prof) setProfile(prof);
    
    const { data: membership } = await db.from("room_members").select("room_id").eq("user_id", auth.session.user.id).maybeSingle();
    if (!membership) return;
    
    const { data: r } = await db.from("rooms").select("*").eq("id", membership.room_id).single();
    if (!r) return;
    setRoom(r);
    
    const [{ data: ts }, { data: ps }, { data: bids }] = await Promise.all([
      db.from("team_public_state").select("*").eq("room_id", r.id).order("name"),
      db.from("players").select("*").eq("room_id", r.id).order("queue_position"),
      db.from("bids").select("id,amount,created_at,teams(name),players(name)").eq("room_id", r.id).order("created_at", { ascending: false }).limit(30)
    ]);
    
    setTeams((ts || []) as Team[]);
    setPlayers((ps || []) as Player[]);
    setHistory(bids || []);
    
    const cp = (ps || []).find((p: any) => p.id === r.current_player_id) || null;
    setCurrentPlayer(cp);
    
    const amount = Number(r.current_bid || 0);
    const base = Number(cp?.base_price || 2);
    setNextBid(Number((amount ? amount + (amount < 5 ? 0.2 : 0.5) : base).toFixed(1)));
  }, [db]);
  
  useEffect(() => {
    db.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: authListener } = db.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => authListener.subscription.unsubscribe();
  }, [db]);

  useEffect(() => { if (session) refresh(); }, [session, refresh]);

  useEffect(() => {
    if (!room?.id) return;
    const channel = db.channel("wcl-room-" + room.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${room.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids", filter: `room_id=eq.${room.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${room.id}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "squads", filter: `room_id=eq.${room.id}` }, refresh)
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [db, room?.id, refresh]);
  

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const myTeam = teams.find(t => t.id === profile?.team_id);
  const leader = teams.find(t => t.id === room?.leading_team_id);
  const seconds = room?.countdown_ends_at ? Math.max(0, Math.ceil((new Date(room.countdown_ends_at).getTime() - clock) / 1000)) : null;
  const isAdmin = profile?.role === "auctioneer";
    async function auth(signUp: boolean) {
    setBusy(true); setMessage("");
    const result = signUp
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) setMessage(result.error.message);
    else if (signUp) setMessage("Account created. Verify your email if Supabase email confirmation is enabled, then sign in.");
  }
  async function createRoom() {
    if (!session) {
      setMessage("Please sign in first.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const { data, error } = await db.from("rooms").insert({
        code: roomCode.trim().toUpperCase(),
        password: adminPassword,
        status: "live"
      }).select("id").maybeSingle();

      if (error) {
        setMessage("Error creating room: " + error.message);
      } else if (data) {
        setMessage("Room created successfully! Now click '2. Join as Auctioneer' to enter.");
      }
    } catch (err: any) {
      setMessage(err.message || "An error occurred while creating room.");
    }
    setBusy(false);
  }
  
    async function joinRoom() {
    if (!session) {
      setMessage("Please sign in first.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const { data: targetRoom, error: roomErr } = await db.from("rooms").select("id, password").eq("code", roomCode.trim().toUpperCase()).maybeSingle();
      
      if (roomErr || !targetRoom) {
        setMessage("Invalid Room code.");
        setBusy(false);
        return;
      }

      if (teamId === "") {
        if (adminPassword !== targetRoom.password) {
          setMessage("Incorrect Admin Password! You cannot become Auctioneer.");
          setBusy(false);
          return;
        }
        await db.from("room_members").upsert({ room_id: targetRoom.id, user_id: session.user.id });
        await db.from("profiles").update({ role: "auctioneer", team_id: null }).eq("id", session.user.id);
      } else {
        const { data: validTeam, error: teamErr } = await db.from("teams").select("id").eq("room_id", targetRoom.id).eq("name", teamId).eq("pin", teamPin).maybeSingle();
        if (teamErr || !validTeam) {
          setMessage("Invalid Team PIN for the selected team.");
          setBusy(false);
          return;
        }
        await db.from("room_members").upsert({ room_id: targetRoom.id, user_id: session.user.id });
        await db.from("profiles").update({ role: "team", team_id: validTeam.id }).eq("id", session.user.id);
      }

      setMessage("Joined room successfully!");
      await refresh();
    } catch (err: any) {
      setMessage(err.message || "An error occurred while joining.");
    }
    setBusy(false);
    }
  

  async function act(fn: string, args: Record<string, any> = {}) {
    setBusy(true); setMessage("");
    const { error } = await db.rpc(fn, args);
    setBusy(false);
    if (error) setMessage(error.message);
    else { setMessage("Action accepted."); await refresh(); }
  }

  async function placeBid() {
    if (!room) return;
    setBusy(true); setMessage("");
    const { error } = await db.rpc("place_bid", { p_room_id: room.id });
    setBusy(false);
    if (error) setMessage(error.message);
    else { setMessage("Bid accepted."); await refresh(); }
  }

  async function addPlayer() {
    if (!room) return;
    setBusy(true);
    const { error } = await db.rpc("admin_add_player", {
      p_room_id: room.id, p_name: newPlayer.name, p_country: newPlayer.country,
      p_role: newPlayer.role, p_batting_style: newPlayer.batting,
      p_bowling_style: newPlayer.bowling, p_base_price: Number(newPlayer.base)
    });
    setBusy(false);
    if (error) setMessage(error.message);
    else { setNewPlayer({ name: "", country: "India", role: "Batter", batting: "", bowling: "", base: "2" }); setMessage("Player added."); refresh(); }
  }

  async function exportCsv() {
    if (!room) return;
    const { data, error } = await db.from("squads").select("teams(name),players(name,role,country),price").eq("room_id", room.id);
    if (error) { setMessage(error.message); return; }
    const rows = [["Team", "Player", "Role", "Country", "Price Cr"], ...(data || []).map((x: any) => [x.teams?.name, x.players?.name, x.players?.role, x.players?.country, x.price])];
    const csv = rows.map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "WCL-auction-results.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
     if (!session) return <main className="wrap">
    <header><div><div className="brand">WCL <b>AUCTION ROOM</b></div><div className="muted">SEASON 1 · PRIVATE MULTIPLAYER AUCTION</div></div><span className="pill">SETUP REQUIRED</span></header>
    <section className="card login">
      <h1>Enter the auction room</h1><p className="muted">Create an account or sign in first. Then build or enter your room credentials.</p>
      <label>Email</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com"/>
      <label>Password</label><input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Account password"/>
      <div className="actions"><button disabled={busy} onClick={() => auth(false)}>Sign in</button><button className="alt" disabled={busy} onClick={() => auth(true)}>Create account</button></div>
      <hr/>
      <h3>Enter Room Details</h3><label>Room code</label><input value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="WCLS1"/>
      <label>Team Type / Role</label>
      <select value={teamId} onChange={e => setTeamId(e.target.value)}>
        <option value="">Auctioneer (Owner)</option>
        {["Trinbago Knight Riders","Chennai Super Kings","Mumbai Indians","Kolkata Knight Riders","Royal Challengers Bengaluru","Rajasthan Royals","Sunrisers Hyderabad","Delhi Capitals","Punjab Kings","Gujarat Titans"].map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {teamId === "" ? (
        <>
          <label>Admin/Room Password</label>
          <input value={adminPassword} onChange={e => setAdminPassword(e.target.value)} type="password" placeholder="Enter Room Admin Password"/>
          <div className="actions" style={{gap: '10px', marginTop: '15px'}}>
            <button disabled={busy} onClick={createRoom} style={{backgroundColor: '#22c55e', color: 'white'}}>1. Create New Room</button>
            <button disabled={busy} onClick={joinRoom}>2. Join as Auctioneer</button>
          </div>
        </>
      ) : (
        <>
          <label>Room password</label>
          <input value={roomPassword} onChange={e => setRoomPassword(e.target.value)} type="password" placeholder="Enter Room Password"/>
          <label>Team PIN</label>
          <input value={teamPin} onChange={e => setTeamPin(e.target.value)} type="password" placeholder="Provided by auction organiser"/>
          <button disabled={busy} onClick={joinRoom} style={{marginTop: '15px'}}>Join Team Room</button>
        </>
      )}
      {message && <p className="notice" style={{marginTop: '15px'}}>{message}</p>}
    </section>
  </main>;

  if (!room || !profile) return <main className="wrap">
    <header><div className="brand">WCL <b>AUCTION ROOM</b></div><button className="alt" onClick={() => db.auth.signOut()}>Sign out</button></header>
    <section className="card">
      <h2>You're signed in</h2><p className="muted">Create or Join your room.</p>
      <label>Room code</label><input value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="WCLS1" />
      <label>Team</label>
      <select value={teamId} onChange={e => setTeamId(e.target.value)}>
        <option value="">Auctioneer (Owner)</option>
        {["Trinbago Knight Riders","Chennai Super Kings","Mumbai Indians","Kolkata Knight Riders","Royal Challengers Bengaluru","Rajasthan Royals","Sunrisers Hyderabad","Delhi Capitals","Punjab Kings","Gujarat Titans"].map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {teamId === "" ? (
        <>
          <label>Admin/Room Password</label>
          <input value={adminPassword} onChange={e => setAdminPassword(e.target.value)} type="password" placeholder="Enter Room Admin Password"/>
          <div className="actions" style={{gap: '10px', marginTop: '15px'}}>
            <button disabled={busy} onClick={createRoom} style={{backgroundColor: '#22c55e', color: 'white'}}>1. Create New Room</button>
            <button disabled={busy} onClick={joinRoom}>2. Join as Auctioneer</button>
          </div>
        </>
      ) : (
        <>
          <label>Room password</label>
          <input type="password" value={roomPassword} onChange={e => setRoomPassword(e.target.value)} placeholder="Enter Room Password"/>
          <label>Team PIN</label>
          <input type="password" value={teamPin} onChange={e => setTeamPin(e.target.value)} placeholder="Enter Team PIN"/>
          <button disabled={busy} onClick={joinRoom} style={{marginTop: '15px'}}>Join Team Room</button>
        </>
      )}
      {message && <p className="notice" style={{marginTop: '15px'}}>{message}</p>}
    </section>
  </main>;
      return <main className="wrap">
    <header><div><div className="brand">WCL <b>AUCTION ROOM</b></div><div className="muted">SEASON 1 · 10 TEAMS · ₹150 CR PURSE</div></div><div className="headerRight"><span className="pill">{room.status.toUpperCase()}</span><span className="connected">● LIVE CONNECTION</span><button className="alt" onClick={() => db.auth.signOut()}>Sign out</button></div></header>
    {message && <div className="notice">{message}</div>}
    {room.warning_stage > 0 && <div className="warning">{room.warning_stage === 1 ? "⚠ WARNING" : room.warning_stage === 2 ? "⚠ FINAL WARNING" : "BIDDING CLOSED — AWAITING AUCTIONEER"}</div>}
    <div className="grid">
      <section className="card playerCard">
        <div className="muted">PLAYER ON THE BLOCK</div>
        {currentPlayer ? <><div className="playerLine">{currentPlayer.image_url ? <img src={currentPlayer.image_url} alt="" /> : <div className="avatar">🏏</div>}<div><h1>{currentPlayer.name}</h1><div className="muted">{currentPlayer.country} · {currentPlayer.player_type} · {currentPlayer.role}</div><div className="muted">{currentPlayer.batting_style || "Batting style n/a"} · {currentPlayer.bowling_style || "Bowling style n/a"}</div></div></div><div className="big">{money(room.current_bid || currentPlayer.base_price)}</div><div className="muted">{leader ? `LEADING: ${leader.name}` : "NO BIDS YET"} · NEXT BID {money(nextBid)}</div></> : <h2>No player selected</h2>}
        {seconds !== null && <div className="countdown">{seconds > 0 ? seconds : "BIDS CLOSED"}</div>}
        <div className="actions">{!isAdmin && <button disabled={busy || room.status !== "live" || !currentPlayer || seconds === 0 || !myTeam} onClick={placeBid}>Place next bid · {money(nextBid)}</button>}
          {isAdmin && <><button onClick={() => act("auction_start", {p_room_id: room.id})}>Start</button><button className="alt" onClick={() => act("auction_pause", {p_room_id: room.id})}>Pause</button><button className="alt" onClick={() => act("auction_resume", {p_room_id: room.id})}>Resume</button><button className="red" onClick={() => {if(confirm("End the auction?")) act("auction_end", {p_room_id: room.id})}}>End auction</button></>}
        </div>
        {isAdmin && <div className="actions adminActions"><button className="alt" onClick={() => act("auction_warning", {p_room_id: room.id})}>WARNING</button><button className="alt" onClick={() => act("auction_final_warning", {p_room_id: room.id})}>FINAL WARNING</button><button className="red" onClick={() => act("auction_countdown", {p_room_id: room.id})}>START 5-4-3-2-1</button><button className="green" onClick={() => act("auction_mark_sold", {p_room_id: room.id})}>MARK SOLD</button><button className="alt" onClick={() => act("auction_next_player", {p_room_id: room.id})}>NEXT PLAYER</button><button className="red" onClick={() => act("auction_mark_unsold", {p_room_id: room.id})}>MARK UNSOLD</button></div>}
      </section>
      <section className="card"><h3>{isAdmin ? "Auctioneer control room" : "My team dashboard"}</h3>
        {myTeam ? <><div className="stats"><div className="stat"><div className="muted">PURSE REMAINING</div><b className="big">{money(myTeam.purse_remaining)}</b></div><div className="stat"><div className="muted">SQUAD SIZE</div><b className="big">{myTeam.squad_count}/18</b></div><div className="stat"><div className="muted">OVERSEAS</div><b>{myTeam.overseas_count}/8</b></div><div className="stat"><div className="muted">SPENT</div><b>{money(150 - myTeam.purse_remaining)}</b></div></div></> : <p className="muted">Auctioneer view · all teams visible below.</p>}
        <p className="muted">Squad minimum: 15 · maximum: 18 · overseas maximum: 8 · Playing XI overseas maximum: 4.</p>
      </section>
    </div>
    {isAdmin && <section className="card"><h3>Player queue management</h3><div className="formGrid"><input placeholder="Player name" value={newPlayer.name} onChange={e => setNewPlayer({...newPlayer,name:e.target.value})}/><input placeholder="Country" value={newPlayer.country} onChange={e => setNewPlayer({...newPlayer,country:e.target.value})}/><select value={newPlayer.role} onChange={e => setNewPlayer({...newPlayer,role:e.target.value})}>{["Batter","Bowler","All-rounder","Wicketkeeper"].map(x=><option key={x}>{x}</option>)}</select><select value={newPlayer.country === "India" ? "Indian" : "Overseas"} onChange={e => setNewPlayer({...newPlayer,country:e.target.value === "Indian" ? "India" : "Overseas"})}><option>Indian</option><option>Overseas</option></select><input placeholder="Batting style" value={newPlayer.batting} onChange={e => setNewPlayer({...newPlayer,batting:e.target.value})}/><input placeholder="Bowling style" value={newPlayer.bowling} onChange={e => setNewPlayer({...newPlayer,bowling:e.target.value})}/><input type="number" min="2" step=".2" value={newPlayer.base} onChange={e => setNewPlayer({...newPlayer,base:e.target.value})}/><button disabled={busy || !newPlayer.name.trim()} onClick={addPlayer}>Add player</button></div><p className="muted">Full edit/reorder/import tools are listed in the setup roadmap; database permissions already restrict player mutations to the auctioneer.</p></section>}
    <section className="card"><h3>Teams & purse tracker</h3><div className="teams">{teams.map(t=><div className={`team ${t.id===profile.team_id?"active":""}`} key={t.id}><b>{t.name}</b><div className="teamMoney">{money(t.purse_remaining)}</div><div className="muted">{t.squad_count} players · {t.overseas_count} overseas</div></div>)}</div></section>
    <div className="grid"><section className="card"><h3>Player queue</h3><div className="tableWrap"><table><thead><tr><th>Player</th><th>Country</th><th>Role</th><th>Base</th><th>Status</th></tr></thead><tbody>{players.map(p=><tr key={p.id} className={p.id===room.current_player_id?"selected":""}><td>{p.name}</td><td>{p.country}</td><td>{p.role}</td><td>{money(p.base_price)}</td><td>{p.status}</td></tr>)}</tbody></table></div></section>
      <section className="card"><h3>Live bid history</h3>{history.length ? history.map((b:any)=><div className="history" key={b.id}><b>{b.teams?.name || "Team"}</b> bid {money(b.amount)}<div className="muted">{b.players?.name} · {new Date(b.created_at).toLocaleTimeString()}</div></div>) : <p className="muted">No accepted bids yet.</p>}<div className="actions"><button className="alt" onClick={exportCsv}>Export CSV</button></div></section></div>
    <footer>WCL AUCTION ROOM · Virtual credits only · Connection state is shown above</footer>
  </main>;
}
