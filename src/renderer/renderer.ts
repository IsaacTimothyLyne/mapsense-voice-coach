console.log('renderer script');

// ================= STATUS BADGE =================
function setStatus(text: string, tone: 'idle'|'ok'|'warn'|'err'='idle') {
  const el = document.getElementById('ms_status') as HTMLElement | null;
  if (!el) return;
  el.textContent = text;
  el.style.background = tone === 'ok' ? '#e9f7ef'
      : tone === 'warn' ? '#fff7e5'
          : tone === 'err' ? '#ffe9e9'
              : '#eef3ff';
  el.style.color = tone === 'ok' ? '#1b7f47'
      : tone === 'warn' ? '#9a6a00'
          : tone === 'err' ? '#a11'
              : '#2b4bff';
}

// ================= SETTINGS + QUEUE =================
type Settings = { speakKills:boolean; speakObjectives:boolean; speakMIA:boolean; rate:number; muted:boolean; };
const DEFAULTS: Settings = { speakKills:true, speakObjectives:true, speakMIA:true, rate:1.1, muted:false };
const load = (): Settings => ({ ...DEFAULTS, ...JSON.parse(localStorage.getItem('mapsense_settings') || '{}') });
const save = (s: Settings) => localStorage.setItem('mapsense_settings', JSON.stringify(s));
let S = load();

let speaking = false;
const q: string[] = [];
function setRate(rate:number){ S.rate = rate; save(S); }
function enqueue(text: string) {
  console.log('[enqueue]', text, '| muted=', S.muted);
  if (S.muted) return;
  q.push(text);
  pump();
}
function pump() {
  if (speaking || q.length === 0) return;
  speaking = true;
  const text = q.shift()!;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = S.rate;
  u.onstart = () => console.log('[TTS] start:', text);
  u.onerror = (e) => console.warn('[TTS] error:', e);
  u.onend = () => { console.log('[TTS] end'); speaking = false; pump(); };
  try { speechSynthesis.speak(u); } catch (e) { console.warn('[TTS] speak threw', e); speaking = false; }
}

// --- COOLDOWNS ---
const cd = new Map<string, number>();
function canSay(key: string, ms: number) {
  const now = Date.now();
  const t = cd.get(key) || 0;
  if (now < t) return false;
  cd.set(key, now + ms);
  return true;
}

// ================= LoL FEATURES =================
const FEATURES = [
  'summoner_info','gameMode','teams','matchState',
  'kill','death','respawn','assist','minions','level','abilities',
  'announcer','counters','match_info','damage','heal',
  'live_client_data','jungle_camps','team_frames'
];

function addMessageToTerminal(message: string) {
  const terminal = document.querySelector('#TerminalTextArea') as any;
  if (!terminal) return;
  terminal.append(message + '\n');
  terminal.scrollTop = terminal.scrollHeight;
}

function isLoL(res: any): boolean {
  const id = res?.gameInfo?.id ?? res?.id;
  return !!id && Math.floor(id / 10) === 5426;
}

// ================= DIRECT GEP HOOK =================
function setFeaturesDirect() {
  // @ts-ignore
  const gep = window.overwolf?.games?.events;
  if (!gep?.setRequiredFeatures) {
    console.warn('GEP not ready, retrying…');
    setStatus('GEP not ready', 'warn');
    setTimeout(setFeaturesDirect, 1500);
    return;
  }
  // @ts-ignore
  gep.setRequiredFeatures(FEATURES, (info: any) => {
    console.log('setRequiredFeatures (direct) response:', info);
    if (!info || info.success === false) {
      setStatus('Features failed; retrying…', 'warn');
      setTimeout(setFeaturesDirect, 2000);
    } else {
      setStatus('Features set', 'ok');
      addMessageToTerminal('setRequiredFeatures ok (direct)');
    }
  });
}

function hookGame() {
  // @ts-ignore
  window.overwolf.games.getRunningGameInfo((res: any) => {
    if (res?.isRunning && isLoL(res)) {
      setStatus('LoL detected', 'ok');
      setTimeout(setFeaturesDirect, 1000);
    } else {
      setStatus('Idle', 'idle');
    }
  });
  // @ts-ignore
  window.overwolf.games.onGameInfoUpdated.addListener((res: any) => {
    if (res?.gameInfo?.isRunning && (res.runningChanged || res.gameChanged) && isLoL(res)) {
      setStatus('LoL launched', 'ok');
      setTimeout(setFeaturesDirect, 1000);
    }
  });
}

// ================= EVENT -> SPEECH =================
function sayEvent(name: string) {
  switch (name) {
    case 'kill':       if (S.speakKills && canSay('kill', 1500)) enqueue('You got a kill'); break;
    case 'assist':     if (S.speakKills && canSay('assist', 1500)) enqueue('Assist'); break;
    case 'death':      if (S.speakKills && canSay('death', 1500)) enqueue('You died'); break;
    case 'respawn':    if (S.speakKills && canSay('respawn', 1500)) enqueue('You are back'); break;
    case 'dragonKill': if (S.speakObjectives && canSay('dragonKill', 4000)) enqueue('Dragon taken'); break;
    case 'baronKill':  if (S.speakObjectives && canSay('baronKill', 4000)) enqueue('Baron taken'); break;
  }
}

// Keep sample bus for logging; also parse events -> sayEvent
// @ts-ignore
window.gep.onMessage(function (...args: any[]) {
  let item = '';
  args.forEach(arg => (item = `${item}-${JSON.stringify(arg)}`));
  addMessageToTerminal(item);

  for (const arg of args) {
    const events = (arg && arg.events && Array.isArray(arg.events)) ? arg.events : null;
    if (!events) continue;
    events.forEach((ev: any) => sayEvent(ev.name));
  }
});

// ================= CONTROL PANEL =================
function initPanel() {
  // Reflect stored toggles
  const k = document.getElementById('opt_kills') as HTMLInputElement | null; if (k) k.checked = S.speakKills;
  const o = document.getElementById('opt_objectives') as HTMLInputElement | null; if (o) o.checked = S.speakObjectives;
  const m = document.getElementById('opt_mia') as HTMLInputElement | null; if (m) m.checked = S.speakMIA;
  const master = document.getElementById('opt_master') as HTMLInputElement | null; if (master) master.checked = !S.muted;
  const rateEl = document.getElementById('opt_rate') as HTMLInputElement | null; if (rateEl) rateEl.value = String(S.rate);
  const rateVal = document.getElementById('opt_rate_val') as HTMLElement | null; if (rateVal) rateVal.textContent = S.rate.toFixed(2) + '×';

  // Bind controls
  k?.addEventListener('change', e => { S.speakKills = (e.target as HTMLInputElement).checked; save(S); });
  o?.addEventListener('change', e => { S.speakObjectives = (e.target as HTMLInputElement).checked; save(S); });
  m?.addEventListener('change', e => { S.speakMIA = (e.target as HTMLInputElement).checked; save(S); });
  rateEl?.addEventListener('input', e => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setRate(val);
    if (rateVal) rateVal.textContent = val.toFixed(2) + '×';
  });

  const doMute = () => { S.muted = true; save(S); master && (master.checked = false); setStatus('Muted', 'warn'); };
  const doUnmute = () => { S.muted = false; save(S); master && (master.checked = true); setStatus('Unmuted', 'ok'); };
  const mute = document.getElementById('btn_mute');     mute?.addEventListener('click', doMute);
  const unmute = document.getElementById('btn_unmute'); unmute?.addEventListener('click', doUnmute);
  master?.addEventListener('change', e => { (e.target as HTMLInputElement).checked ? doUnmute() : doMute(); });

  // Speak test – robust binding + global fallback
  const test = document.getElementById('btn_test_voice') as HTMLButtonElement | null;
  const speakTest = () => { console.log('[UI] Speak test'); enqueue('MapSense ready'); };
  test?.addEventListener('click', speakTest);
  (window as any).mapsenseSpeakTest = speakTest; // fallback if you want onclick="mapsenseSpeakTest()"

  // Keyboard: T = test
  document.addEventListener('keydown', (ev) => {
    if (ev.key && ev.key.toLowerCase() === 't') speakTest();
  });

  // Objective buttons (manual test)
  document.getElementById('btn_start_drake')?.addEventListener('click', () => startObjective('dragon', 5 * 60_000));
  document.getElementById('btn_start_baron')?.addEventListener('click', () => startObjective('baron', 20 * 60_000));
  document.getElementById('btn_clear_timers')?.addEventListener('click', clearObjectives);
}

// ================= OBJECTIVE COUNTDOWNS (manual) =================
type Obj = 'dragon' | 'baron';
type Handle = ReturnType<typeof setTimeout>;
const timers: Handle[] = [];
function clearObjectives() { timers.forEach(clearTimeout); timers.length = 0; addMessageToTerminal('objective timers cleared'); }
function schedule(ms: number, fn: () => void) { const h = setTimeout(fn, ms); timers.push(h); }
function speakObj(msg: string, key: string) { if (!S.speakObjectives) return; if (canSay(key, 6000)) enqueue(msg); }
function startObjective(obj: Obj, spawnMs: number) {
  clearObjectives();
  const name = obj === 'dragon' ? 'Dragon' : 'Baron';
  addMessageToTerminal(`starting ${name} timer in ${(spawnMs / 1000) | 0}s`);
  const plan = [
    { t: spawnMs - 60_000, msg: `${name} in one minute`, key: `${obj}_60` },
    { t: spawnMs - 30_000, msg: `${name} in thirty seconds`, key: `${obj}_30` },
    { t: spawnMs - 15_000, msg: `${name} in fifteen seconds`, key: `${obj}_15` },
    { t: spawnMs,          msg: `${name} is up`,            key: `${obj}_0`  }
  ].filter(x => x.t >= 0);
  plan.forEach(p => schedule(p.t, () => speakObj(p.msg, p.key)));
}

// ================= STARTUP =================
document.addEventListener('DOMContentLoaded', () => {
  setStatus('Booting…', 'idle');
  initPanel();
  hookGame();
});
