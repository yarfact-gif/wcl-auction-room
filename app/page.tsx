"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import * as XLSX from "xlsx";

type Team = { id: string; name: string; purse_remaining: number; squad_count: number; overseas_count: number };
type Player = { id: string; name: string; country: string; player_type: string; role: string; batting_style: string; bowling_style: string; base_price: number; status: string; image_url?: string | null;
  auction_category?: string | null;
}; 
type RoomState = { id: string; auction_mode?: string; status: string; current_player_id: string | null; current_bid: number; leading_team_id: string | null; warning_stage: number; countdown_ends_at: string | null };
type Profile = { role: string; team_id: string | null; display_name: string | null };
type SquadEntry = {
  id: number;
  price: number;
  teams?: { name: string }[] | { name: string } | null;
  players?: { name: string; role: string; country: string }[] | { name: string; role: string; country: string } | null;
};

const money = (n: number) => `₹${Number(n || 0).toFixed(2)} Cr`;
const CATEGORIES = [
  "Marquee", "Batsman", "All-rounder", "Wicketkeeper", "Fast Bowler", "Spinner",
  "Uncapped Batsman", "Uncapped All-rounder", "Uncapped Wicketkeeper",
  "Uncapped Fast Bowler", "Uncapped Spinner"
] as const;
type ImportPlayer = {
  name: string; country: string; role: string; category: string;
  batting_style: string; bowling_style: string; base_price: number;
};
const TEAM_NAMES = [
  "Trinbago Knight Riders", "Chennai Super Kings", "Mumbai Indians",
  "Kolkata Knight Riders", "Royal Challengers Bengaluru", "Rajasthan Royals",
  "Sunrisers Hyderabad", "Delhi Capitals", "Punjab Kings", "Gujarat Titans"
];

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
  const [squadEntries, setSquadEntries] = useState<SquadEntry[]>([]);
  const [showSquad, setShowSquad] = useState(false);
  const [squadLoading, setSquadLoading] = useState(false);
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [auctionMode, setAuctionMode] = useState("random");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [importRows, setImportRows] = useState<ImportPlayer[]>([]);
  const [importFileName, setImportFileName] = useState("");
const [playerFilter, setPlayerFilter] = useState("all"); 
  const totalPlayers = players.length;
const soldPlayers = players.filter(p => p.status === "sold").length;
const unsoldPlayers = players.filter(p => p.status === "unsold").length;
const upcomingPlayers = players.filter(p => p.status === "upcoming").length;
const currentPlayers = players.filter(p => p.status === "current").length;
const filteredPlayers = playerFilter === "all"
  ? players
  : players.filter(p => p.status === playerFilter);  
 const [nextBid, setNextBid] = useState(2.2);
  const [clock, setClock] = useState(Date.now());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatedCredentials, setGeneratedCredentials] = useState<{ roomCode: string; teams: { name: string; pin: string }[] } | null>(null);
  const [newPlayer, setNewPlayer] = useState({
  name: "",
  country: "India",
  playerType: "Indian",  
  role: "Batter",
  category: "Marquee",
  batting: "",
  bowling: "",
  base: "0.20"
}); const [customBase, setCustomBase] = useState("");
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
    setAuctionMode(r.auction_mode || "random");
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
const base = Number(cp?.base_price || 0.20);

const increment = amount < 0.50
  ? 0.05
  : amount < 1.00
    ? 0.10
    : amount < 5.00
      ? 0.20
      : 0.50;

setNextBid(Number((amount > 0 ? amount + increment : base).toFixed(2)));
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
  function generateUniquePins(count: number) {
    const pins = new Set<string>();
    const values = new Uint32Array(1);
    while (pins.size < count) {
      crypto.getRandomValues(values);
      pins.add(String(values[0] % 10000).padStart(4, "0"));
    }
    return Array.from(pins);
  }

  async function createRoom() {
    if (!session) { setMessage("Please sign in first."); return; }
    if (!roomCode.trim() || !adminPassword) { setMessage("Enter a room code and admin password first."); return; }
    setBusy(true); setMessage(""); setGeneratedCredentials(null);
    try {
      const pins = generateUniquePins(TEAM_NAMES.length);
      const { data, error } = await db.rpc("create_private_room", {
        p_room_code: roomCode.trim().toUpperCase(),
        p_admin_password: adminPassword,
        p_team_names: TEAM_NAMES,
        p_team_pins: pins
      });
      if (error) throw error;
      setGeneratedCredentials({ roomCode: roomCode.trim().toUpperCase(), teams: TEAM_NAMES.map((name, i) => ({ name, pin: pins[i] })) });
      setMessage("Room created! Save these team PINs now. They will not be shown again.");
    } catch (err: any) {
      setMessage("Error creating room: " + (err.message || "Unknown error"));
    } finally { setBusy(false); }
  }
    async function joinRoom() {
    if (!session) { setMessage("Please sign in first."); return; }
    const suppliedRoomPassword = teamId === "" ? adminPassword : roomPassword;
    if (!roomCode.trim() || !suppliedRoomPassword) { setMessage("Enter the room code and room password."); return; }
    if (teamId !== "" && !/^\d{4}$/.test(teamPin)) { setMessage("Team PIN must be exactly 4 digits."); return; }
    setBusy(true); setMessage("");
    try {
      const { error } = await db.rpc("join_private_room", {
        p_room_code: roomCode.trim().toUpperCase(),
        p_room_password: suppliedRoomPassword,
        p_team_name: teamId || null,
        p_team_pin: teamId ? teamPin : null
      });
      if (error) throw error;
      setMessage("Joined room successfully!");
      await refresh();
    } catch (err: any) {
      setMessage(err.message || "An error occurred while joining.");
    } finally { setBusy(false); }
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
    if (!room) return;    const selectedBase = newPlayer.base === "custom"
      ? Number(customBase)
      : Number(newPlayer.base);

    if (!Number.isFinite(selectedBase) || selectedBase < 0.20) {
      setMessage("Base price must be at least ₹20 Lakh (0.20 Cr).");
      return;
    }
    setBusy(true);
    const rpcName = editingPlayerId ? "admin_edit_player" : "admin_add_player";
    const rpcArgs = editingPlayerId ? {
      p_room_id: room.id, p_player_id: editingPlayerId, p_name: newPlayer.name,
      p_country: newPlayer.country, p_role: newPlayer.role,
      p_batting_style: newPlayer.batting, p_bowling_style: newPlayer.bowling,
      p_base_price: selectedBase, p_auction_category: newPlayer.category
    } : {
  p_room_id: room.id,
  p_name: newPlayer.name,
  p_country: newPlayer.country,
  p_player_type: newPlayer.playerType,
  p_role: newPlayer.role,
  p_batting_style: newPlayer.batting,
  p_bowling_style: newPlayer.bowling,
  p_base_price: selectedBase,
  p_auction_category: newPlayer.category
};
    const { error } = await db.rpc(rpcName, rpcArgs);
    setBusy(false);
    if (error) setMessage(error.message);
    else { setNewPlayer({
  name: "",
  country: "India",
  playerType: "Indian",
  role: "Batter",
  category: "Marquee",
  batting: "",
  bowling: "",
  base: "0.20"
}); setCustomBase(""); setEditingPlayerId(null); setMessage(editingPlayerId ? "Player updated." : "Player added."); refresh(); }
  }

  async function choosePlayer(playerId: string) {
    if (!room) return;
    await act("admin_select_player", { p_room_id: room.id, p_player_id: playerId });
  }

  async function removePlayer(player: Player) {
    if (!room) return;
    const confirmText = player.status === "current"
      ? `Remove current player ${player.name}? Current bidding will be cleared.`
      : `Remove ${player.name} from the queue?`;
    if (!window.confirm(confirmText)) return;
    await act("admin_remove_player", { p_room_id: room.id, p_player_id: player.id, p_confirm_current: player.status === "current" });
  }

  function beginEdit(player: Player) {
    if (player.status === "sold" || player.status === "current") { setMessage("Only upcoming or unsold players can be edited."); return; }
    setEditingPlayerId(player.id);
    setNewPlayer({ name: player.name, country: player.country, role: player.role, category: player.auction_category || "Marquee", batting: player.batting_style || "", bowling: player.bowling_style || "", base: "custom" });
    setCustomBase(String(player.base_price));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function requeueUnsold(player: Player) {
    if (!room || !window.confirm(`Return ${player.name} to the upcoming queue?`)) return;
    await act("admin_requeue_unsold", { p_room_id: room.id, p_player_id: player.id });
  }

  async function changeAuctionMode(mode: string) {
    if (!room) return;
    await act("admin_set_auction_mode", { p_room_id: room.id, p_mode: mode });
    setAuctionMode(mode);
  }

  async function readImportFile(file?: File) {
    if (!file) return;
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      const rows = raw.map((r) => {
        const get = (...keys: string[]) => {
          const key = Object.keys(r).find(k => keys.includes(k.trim().toLowerCase().replace(/[ _-]/g, "")));
          return key ? r[key] : "";
        };
        return { name: String(get("name","playername" )).trim(), country: String(get("country","nationality")).trim(), role: String(get("role","playerrole")).trim(), category: String(get("category","auctioncategory")).trim(), batting_style: String(get("battingstyle","batting")).trim(), bowling_style: String(get("bowlingstyle","bowling")).trim(), base_price: Number(get("baseprice","basepricecr","price")) };
      });
      setImportRows(rows); setImportFileName(file.name);
      setMessage(`Preview ready: ${rows.length} rows. Check all fields before importing.`);
    } catch (e: any) { setMessage("Could not read file: " + (e?.message || "Invalid file")); }
  }

  async function importPlayers() {
    if (!room || !importRows.length) return;
    const invalid = importRows.findIndex(r => !r.name || !r.country || !r.role || !CATEGORIES.includes(r.category as typeof CATEGORIES[number]) || !Number.isFinite(r.base_price) || r.base_price < 0.20);
    if (invalid >= 0) { setMessage(`Row ${invalid + 2} is invalid. Check name, country, role, category and base price (Cr).`); return; }
    if (!window.confirm(`Import exactly ${importRows.length} players from ${importFileName}?`)) return;
    setBusy(true);
    const { data, error } = await db.rpc("admin_import_players", { p_room_id: room.id, p_players: importRows });
    setBusy(false);
    if (error) setMessage("Import failed: " + error.message);
    else { setMessage(`${data} players imported.`); setImportRows([]); setImportFileName(""); await refresh(); }
  }

  async function openSquad() {
    if (!room) return;
    if (!isAdmin && !profile?.team_id) {
      setMessage("Your team is not assigned to this profile.");
      return;
    }
    setSquadLoading(true);
    setMessage("");
    let query = db.from("squads")
      .select("id,price,teams(name),players(name,role,country)")
      .eq("room_id", room.id);
    if (!isAdmin && profile?.team_id) query = query.eq("team_id", profile.team_id);
    const { data, error } = await query.order("id", { ascending: true });
    setSquadLoading(false);
    if (error) {
      setMessage("Could not load squad: " + error.message);
      return;
    }
    setSquadEntries((data || []) as SquadEntry[]);
    setShowSquad(true);
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
        {TEAM_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
      </select>

      {teamId === "" ? (
  <>
    <label>Admin/Room Password</label>
    <input
      value={adminPassword}
      onChange={e => setAdminPassword(e.target.value)}
      type="password"
      placeholder="Enter Room Admin Password"
    />
    <div className="actions" style={{gap: '10px', marginTop: '15px'}}>
      <button disabled={busy} onClick={createRoom} style={{backgroundColor: '#22c55e', color: 'white'}}>
        1. Create New Room
      </button>
      <button disabled={busy} onClick={joinRoom}>
        2. Join as Auctioneer
      </button>
    </div>
  </>
) : (
  <>
    <label>Room password</label>
    <input
      type="password"
      value={roomPassword}
      onChange={e => setRoomPassword(e.target.value)}
      placeholder="Enter Room Password"
    />
    <label>Team PIN</label>
    <input
      type="password"
      value={teamPin}
      onChange={e => setTeamPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
      inputMode="numeric"
      maxLength={4}
      placeholder="Enter 4-digit Team PIN"
    />
    <button disabled={busy} onClick={joinRoom} style={{marginTop: '15px'}}>
      Join Team Room
    </button>
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
        {TEAM_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
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
          <input type="password" value={teamPin} onChange={e => setTeamPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="Enter 4-digit Team PIN"/>
          <button disabled={busy} onClick={joinRoom} style={{marginTop: '15px'}}>Join Team Room</button>
        </>
      )}
      {message && <p className="notice" style={{marginTop: '15px'}}>{message}</p>}
      {generatedCredentials && <div className="notice" style={{marginTop: '15px'}}>
        <h3>Save your team PINs now</h3>
        <p>Room code: <b>{generatedCredentials.roomCode}</b></p>
        {generatedCredentials.teams.map(t => <p key={t.name}>{t.name}: <b>{t.pin}</b></p>)}
        <button type="button" className="alt" onClick={() => navigator.clipboard?.writeText(`Room: ${generatedCredentials.roomCode}\n` + generatedCredentials.teams.map(t => `${t.name}: ${t.pin}`).join("\n"))}>Copy all PINs</button>
      </div>}
    </section>
  </main>;
      return <main className="wrap">
    <header><div><div className="brand">WCL <b>AUCTION ROOM</b></div><div className="muted">SEASON 1 · 10 TEAMS · ₹150 CR PURSE</div></div><div className="headerRight"><span className="pill">{room.status.toUpperCase()}</span><span className="connected">● LIVE CONNECTION</span><button className="alt" onClick={() => db.auth.signOut()}>Sign out</button></div></header>
    {message && <div className="notice">{message}</div>}
    {room.warning_stage > 0 && <div className="warning">{room.warning_stage === 1 ? "⚠ WARNING" : room.warning_stage === 2 ? "⚠ FINAL WARNING" : "BIDDING CLOSED — AWAITING AUCTIONEER"}</div>}
    <div className="grid">
      <section className="card playerCard">
        {isAdmin && <div className="stats">
  <div className="stat"
  role="button"
  tabIndex={0}
  style={{ cursor: "pointer" }}
  onClick={() => setPlayerFilter("all")}
>
  <div className="muted">TOTAL PLAYERS</div>
  <b className="big">{totalPlayers}</b>
</div>

<div className="stat"
  role="button"
  tabIndex={0}
  style={{ cursor: "pointer" }}
  onClick={() => setPlayerFilter("sold")}
>
  <div className="muted">SOLD</div>
  <b className="big">{soldPlayers}</b>
</div>

<div className="stat"
  role="button"
  tabIndex={0}
  style={{ cursor: "pointer" }}
  onClick={() => setPlayerFilter("unsold")}
>
  <div className="muted">UNSOLD</div>
  <b className="big">{unsoldPlayers}</b>
</div>

<div className="stat"
  role="button"
  tabIndex={0}
  style={{ cursor: "pointer" }}
  onClick={() => setPlayerFilter("upcoming")}
>
  <div className="muted">UPCOMING</div>
  <b className="big">{upcomingPlayers}</b>
</div>
</div>}
        <div className="muted">PLAYER ON THE BLOCK</div>
        {currentPlayer ? <><div className="playerLine">{currentPlayer.image_url ? <img src={currentPlayer.image_url} alt="" /> : <div className="avatar">🏏</div>}<div><h1>{currentPlayer.name}</h1><div className="muted">{currentPlayer.country} · {currentPlayer.player_type} · {currentPlayer.role}</div><div className="muted">{currentPlayer.batting_style || "Batting style n/a"} · {currentPlayer.bowling_style || "Bowling style n/a"}</div></div></div><div className="big">{money(room.current_bid || currentPlayer.base_price)}</div><div className="muted">{leader ? `LEADING: ${leader.name}` : "NO BIDS YET"} · NEXT BID {money(nextBid)}</div></> : <h2>No player selected</h2>}
        {seconds !== null && <div className="countdown">{seconds > 0 ? seconds : "BIDS CLOSED"}</div>}
        <div className="actions">{!isAdmin && <button disabled={busy || room.status !== "live" || !currentPlayer || seconds === 0 || !myTeam} onClick={placeBid}>Place next bid · {money(nextBid)}</button>}
          {isAdmin && <><button onClick={() => act("auction_start", {p_room_id: room.id})}>Start</button><button className="alt" onClick={() => act("auction_pause", {p_room_id: room.id})}>Pause</button><button className="alt" onClick={() => act("auction_resume", {p_room_id: room.id})}>Resume</button><button className="red" onClick={() => {if(confirm("End the auction?")) act("auction_end", {p_room_id: room.id})}}>End auction</button></>}
        </div>
        {isAdmin && <div className="actions adminActions"><button className="alt" onClick={() => act("auction_warning", {p_room_id: room.id})}>WARNING</button><button className="alt" onClick={() => act("auction_final_warning", {p_room_id: room.id})}>FINAL WARNING</button><button className="red" onClick={() => act("auction_countdown", {p_room_id: room.id})}>START 5-4-3-2-1</button><button className="green" onClick={() => act("auction_mark_sold", {p_room_id: room.id})}>MARK SOLD</button><button className="alt" onClick={() => act("auction_next_player", {p_room_id: room.id})}>NEXT PLAYER</button><button className="red" onClick={() => act("auction_mark_unsold", {p_room_id: room.id})}>MARK UNSOLD</button></div>}
      </section>
      <section className="card"><h3>{isAdmin ? "Auctioneer control room" : "My team dashboard"}</h3>
        {myTeam ? <><div className="stats"><div className="stat"><div className="muted">PURSE REMAINING</div><b className="big">{money(myTeam.purse_remaining)}</b></div><div className="stat"><div className="muted">SQUAD SIZE</div><b className="big">{myTeam.squad_count}/18</b></div><div className="stat"><div className="muted">OVERSEAS</div><b>{myTeam.overseas_count}/8</b></div><div className="stat"><div className="muted">SPENT</div><b>{money(150 - myTeam.purse_remaining)}</b></div></div><div className="actions"><button className="alt" onClick={openSquad} disabled={squadLoading}>{squadLoading ? "Loading squad..." : "View Squad"}</button></div></> : <><p className="muted">Auctioneer view · all teams visible below.</p><div className="actions"><button className="alt" onClick={openSquad} disabled={squadLoading}>{squadLoading ? "Loading squads..." : "View All Squads"}</button></div></>}
        <p className="muted">Squad minimum: 15 · maximum: 18 · overseas maximum: 8 · Playing XI overseas maximum: 4.</p>
      </section>
    </div>
    {isAdmin && <section className="card"><h3>Auction mode</h3><p className="muted">Random mode follows the approved category order and shuffles players within each category. Manual mode waits for your selection.</p><div className="actions"><button className={auctionMode === "random" ? "green" : "alt"} onClick={()=>changeAuctionMode("random")}>Random by category</button><button className={auctionMode === "manual" ? "green" : "alt"} onClick={()=>changeAuctionMode("manual")}>Manual selection</button></div></section>}{isAdmin && <section className="card"><h3>Player queue management</h3><div className="formGrid"><input placeholder="Player name" value={newPlayer.name} onChange={e => setNewPlayer({...newPlayer,name:e.target.value})}/><input placeholder="Country" value={newPlayer.country} onChange={e => setNewPlayer({...newPlayer,country:e.target.value})}/><select
  value={newPlayer.role}
  onChange={e => setNewPlayer({...newPlayer, role:e.target.value})}
>
  <option value="Batter">Batter</option>
  <option value="Bowler">Bowler</option>
  <option value="All-rounder">All-rounder</option>
  <option value="Wicketkeeper">Wicketkeeper</option>
</select>

<select
  
  value={newPlayer.category}
  onChange={e => setNewPlayer({...newPlayer, category:e.target.value})}
>
  {[
    "Marquee",
    "Batsman",
    "All-rounder",
    "Wicketkeeper",
    "Fast Bowler",
    "Spinner",
    "Uncapped Batsman",
    "Uncapped All-rounder",
    "Uncapped Wicketkeeper",
    "Uncapped Fast Bowler",
    "Uncapped Spinner"
  ].map(x => <option key={x} value={x}>{x}</option>)}
<select
  value={newPlayer.playerType}
  onChange={e => {
    const playerType = e.target.value;
    setNewPlayer({
      ...newPlayer,
      playerType,
      country: playerType === "Indian" ? "India" : "Australia"
    });
  }}
>
  <option value="Indian">Indian</option>
  <option value="Overseas">Overseas</option>
</select>

{newPlayer.playerType === "Overseas" && (
  <>
    <select
      value={[
        "Australia", "England", "South Africa", "New Zealand",
        "West Indies", "Sri Lanka", "Bangladesh", "Afghanistan",
        "Zimbabwe"
      ].includes(newPlayer.country) ? newPlayer.country : "Other"}
      onChange={e =>
        setNewPlayer({
          ...newPlayer,
          country: e.target.value === "Other" ? "" : e.target.value
        })
      }
    >
      <option value="Australia">Australia</option>
      <option value="England">England</option>
      <option value="South Africa">South Africa</option>
      <option value="New Zealand">New Zealand</option>
      <option value="West Indies">West Indies</option>
      <option value="Sri Lanka">Sri Lanka</option>
      <option value="Bangladesh">Bangladesh</option>
      <option value="Afghanistan">Afghanistan</option>
      <option value="Zimbabwe">Zimbabwe</option>
      <option value="Other">Other</option>
    </select>

    {![
      "Australia", "England", "South Africa", "New Zealand",
      "West Indies", "Sri Lanka", "Bangladesh", "Afghanistan",
      "Zimbabwe"
    ].includes(newPlayer.country) && (
      <input
        placeholder="Enter country name"
        value={newPlayer.country}
        onChange={e =>
          setNewPlayer({...newPlayer, country: e.target.value})
        }
      />
    )}
  </>
)}
  value={newPlayer.base}
  onChange={e => setNewPlayer({...newPlayer, base:e.target.value})}
>
  <option value="0.20">₹20 Lakh</option>
  <option value="0.50">₹50 Lakh</option>
  <option value="1.00">₹1 Crore</option>
  <option value="2.00">₹2 Crore</option>
  <option value="custom">Custom Price</option>
</select>

{newPlayer.base === "custom" && (
  <input
    type="number"
    min="0.20"
    step="0.01"
    placeholder="Custom price in Crores (e.g. 0.75)"
    value={customBase}
    onChange={e => setCustomBase(e.target.value)}
  />
)}<button disabled={busy || !newPlayer.name.trim()} onClick={addPlayer}>{editingPlayerId ? "Save player changes" : "Add player"}</button>{editingPlayerId && <button type="button" className="alt" onClick={() => { setEditingPlayerId(null); setNewPlayer({name:"",country:"India",role:"Batter",category:"Marquee",batting:"",bowling:"",base:"0.20"}); setCustomBase(""); }}>Cancel edit</button>}</div><div className="divider" />
      <h3>Bulk player import</h3>
      <p className="muted">CSV, XLS or XLSX. Required columns: name, country, role, category, base_price (in Cr). Optional: batting_style, bowling_style. No players are invented automatically.</p>
      <input type="file" accept=".csv,.xls,.xlsx" onChange={e => readImportFile(e.target.files?.[0])} />
      {importRows.length > 0 && <><p className="muted">Preview: {importFileName} · {importRows.length} rows</p><div className="tableWrap"><table><thead><tr><th>Name</th><th>Country</th><th>Role</th><th>Category</th><th>Base Cr</th></tr></thead><tbody>{importRows.slice(0,20).map((r,i)=><tr key={i}><td>{r.name || "Missing"}</td><td>{r.country || "Missing"}</td><td>{r.role || "Missing"}</td><td>{r.category || "Missing"}</td><td>{r.base_price || "Missing"}</td></tr>)}</tbody></table></div>{importRows.length>20 && <p className="muted">Showing first 20 of {importRows.length} rows.</p>}<div className="actions"><button disabled={busy} onClick={importPlayers}>Confirm import {importRows.length} players</button><button className="alt" onClick={()=>setImportRows([])}>Clear preview</button></div></>}
    </section>}
    <section className="card"><h3>Teams & purse tracker</h3><div className="teams">{teams.map(t=><div className={`team ${t.id===profile.team_id?"active":""}`} key={t.id}><b>{t.name}</b><div className="teamMoney">{money(t.purse_remaining)}</div><div className="muted">{t.squad_count} players · {t.overseas_count} overseas</div></div>)}</div></section>
    <div className="grid">
  <section className="card">
    <h3>Player queue</h3>
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Country</th>
            <th>Role</th>
            <th>Category</th>
            <th>Base</th>
            <th>Status</th>
            {isAdmin && <th>Admin actions</th>}
          </tr>
        </thead>
        <tbody>
          {filteredPlayers.map(p => (
            <tr
              key={p.id}
              className={p.id === room.current_player_id ? "selected" : ""}
            >
              <td>{p.name}</td>
              <td>{p.country}</td>
              <td>{p.role}</td>
              <td>{p.auction_category || "Not set"}</td>
              <td>{money(p.base_price)}</td>
              <td>{p.status}</td>
              {isAdmin && <td><div className="actions">
                {p.status === "upcoming" && <button className="alt" onClick={()=>choosePlayer(p.id)} disabled={busy || room.status !== "live" || !!room.current_player_id}>Select</button>}
                {(p.status === "upcoming" || p.status === "unsold") && <button className="alt" onClick={()=>beginEdit(p)}>Edit</button>}
                {p.status === "unsold" && <button className="green" onClick={()=>requeueUnsold(p)}>Requeue</button>}
                {p.status !== "sold" && <button className="red" onClick={()=>removePlayer(p)}>Remove</button>}
              </div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      </section>  
      <section className="card"><h3>Live bid history</h3>{history.length ? history.map((b:any)=><div className="history" key={b.id}><b>{b.teams?.name || "Team"}</b> bid {money(b.amount)}<div className="muted">{b.players?.name} · {new Date(b.created_at).toLocaleTimeString()}</div></div>) : <p className="muted">No accepted bids yet.</p>}<div className="actions"><button className="alt" onClick={exportCsv}>Export CSV</button></div></section></div>
    {showSquad && <div className="modalBackdrop" role="presentation" onClick={() => setShowSquad(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.78)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}><section className="card" role="dialog" aria-modal="true" aria-label={isAdmin ? "All team squads" : "My squad"} onClick={e => e.stopPropagation()} style={{width:"min(760px,100%)",maxHeight:"85vh",overflowY:"auto"}}><div className="actions" style={{justifyContent:"space-between",alignItems:"center"}}><h2>{isAdmin ? "All Team Squads" : "My Squad"}</h2><button className="alt" onClick={() => setShowSquad(false)}>Close</button></div>{squadEntries.length ? <div className="tableWrap"><table><thead><tr>{isAdmin && <th>Team</th>}<th>Player</th><th>Role</th><th>Country</th><th>Purchase Price</th></tr></thead><tbody>{squadEntries.map(entry => <tr key={entry.id}>{isAdmin && <td>{(Array.isArray(entry.teams) ? entry.teams?.[0]?.name : entry.teams?.name) || "Team"}</td>}<td>{(Array.isArray(entry.players) ? entry.players[0]?.name : entry.players?.name) || "Player"}</td><td>{(Array.isArray(entry.players) ? entry.players[0]?.role : entry.players?.role) || "—"}</td><td>{(Array.isArray(entry.players) ? entry.players[0]?.country : entry.players?.country) || "—"}</td><td>{money(Number(entry.price))}</td></tr>)}</tbody></table></div> : <p className="muted">No players purchased yet.</p>}</section></div>}
    <footer>WCL AUCTION ROOM · Virtual credits only · Connection state is shown above</footer>
  </main>;
}
