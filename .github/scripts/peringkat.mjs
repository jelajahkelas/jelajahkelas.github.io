// Penghitung papan peringkat JELAS (berjalan di GitHub Actions ±30 menit sekali).
// Membaca entri peringkat murid (koleksi "rk", hanya yang berubah sejak putaran sebelumnya; sisanya
// disimpan di cache Actions), lalu menulis papan ringkas ke koleksi "rkb":
//   rkb/nas_{tk|sd|smp|sma}  papan nasional per jenjang (50 besar)
//   rkb/sch_{kode-sekolah}   papan sekolah (50 besar) + pertandingan antarkelas di sekolah itu
//   rkb/cls_{id-kelas}       papan kelas (semua anggota) + posisi kelas di sekolah dan nasional
// Di awal minggu/bulan, juara minggu/bulan sebelumnya mendapat penghargaan di rkw/{uid}.
// Log hanya berisi angka; tidak ada nama atau data pribadi yang dicetak.
import fs from 'node:fs';

const DRY = process.argv[2] === 'uji'; // mode uji lokal: data dari berkas, tidak menulis ke Firestore
let C = null, SA = null, base = '';
if (!DRY) {
  const src = fs.readFileSync('notif/worker.js', 'utf8').replace('export default {', 'const __default = {')
    + '\nexport { getDoc, patchDoc, accessToken };\nexport function setSA(x) { SA = x; }\n';
  fs.writeFileSync('/tmp/jelas-rk-core.mjs', src);
  C = await import('/tmp/jelas-rk-core.mjs');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT belum ada.'); process.exit(0); }
  SA = JSON.parse(raw); C.setSA(SA);
  base = `https://firestore.googleapis.com/v1/projects/${SA.project_id}/databases/(default)/documents`;
}

const val = (f) => f == null ? null : f.stringValue ?? (f.integerValue != null ? +f.integerValue : undefined) ?? f.doubleValue ?? f.booleanValue
  ?? (f.nullValue !== undefined ? null : f.arrayValue ? (f.arrayValue.values || []).map(val) : f.mapValue ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : null);
async function since(col, after, fields) {
  // semua dokumen col dengan upd > after (berhalaman, urut upd)
  const out = []; let cur = after;
  for (let page = 0; page < 200; page++) {
    const body = { structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: 'upd' }, op: 'GREATER_THAN', value: { integerValue: String(cur) } } },
      orderBy: [{ field: { fieldPath: 'upd' }, direction: 'ASCENDING' }], limit: 300, ...(fields ? { select: { fields: fields.map((f) => ({ fieldPath: f })) } } : {}) } };
    const r = await fetch(base + ':runQuery', { method: 'POST', headers: { Authorization: 'Bearer ' + await C.accessToken(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(col + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
    const docs = j.filter((x) => x.document).map((x) => { const o = { id: x.document.name.split('/').pop() }; Object.entries(x.document.fields || {}).forEach(([k, v]) => { o[k] = val(v); }); return o; });
    out.push(...docs); if (docs.length < 300) break; cur = docs[docs.length - 1].upd;
  }
  return out;
}

// ---------- waktu (patokan WIT/UTC+9 agar minggu baru dimulai serempak untuk seluruh Indonesia) ----------
const NOW = DRY && process.env.RK_NOW ? new Date(process.env.RK_NOW) : new Date();
const wit = (d) => new Date(d.getTime() + 9 * 3600e3);
const ymd = (d) => d.toISOString().slice(0, 10);
const monOf = (d) => { const w = wit(d), dow = (w.getUTCDay() + 6) % 7; return ymd(new Date(w.getTime() - dow * 864e5)); };
const W = monOf(NOW), PW = monOf(new Date(NOW.getTime() - 7 * 864e5)), PPW = monOf(new Date(NOW.getTime() - 14 * 864e5));
const MO = ymd(wit(NOW)).slice(0, 7), PMO = (() => { const w = wit(NOW); return ymd(new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), 0))).slice(0, 7); })();
// selisih jam sejak awal minggu/bulan (WIT): penutupan ditunggu sampai semua zona waktu Indonesia sudah lewat tengah malam (+3 jam)
const hrsIntoWeek = (wit(NOW).getTime() - Date.parse(W + 'T00:00:00Z')) / 3600e3;
const hrsIntoMonth = (wit(NOW).getTime() - Date.parse(MO + '-01T00:00:00Z')) / 3600e3;

// ---------- cache ----------
const CF = '.rkcache/state.json';
let S = { rkLast: 0, clsLast: 0, usrLast: 0, refLast: 0, rk: {}, usr: {}, cls: {}, ref: {}, refDone: {}, hash: {}, finW: null, finM: null, lastW: {}, lastM: {} };
try { S = Object.assign(S, JSON.parse(fs.readFileSync(DRY && process.env.RK_STATE ? process.env.RK_STATE : CF, 'utf8'))); } catch (_) {}

// ---------- entri dari akun murid (supaya semua pengguna tampil walau belum membuka versi terbaru) ----------
const witDay = (ms) => ymd(wit(new Date(ms)));
function fromUser(u) {
  if (u.role !== 'student' || u.disabled) return null;
  let p = {}; try { p = JSON.parse(u.p || '{}'); } catch (_) { return null; }
  const today = witDay(NOW.getTime()), yest = witDay(NOW.getTime() - 864e5);
  const wk = p.week || {}, days = Array.isArray(p.ld) && p.ld.length ? p.ld : (Array.isArray(p.hist) ? p.hist : []);
  const st = (p.lastDay === today || p.lastDay === yest) ? (+p.streak || 0) : 0;
  const xpd = p.xpd || {}, msum = Object.entries(xpd).filter(([k]) => k.startsWith(MO)).reduce((a, [, v]) => a + (+v || 0), 0);
  const mxp = p.mxp && p.mxp.mo === MO ? Math.max(+p.mxp.xp || 0, msum) : msum;
  const fr = p.rkFrame && NOW.getTime() - (+p.rkFrame.at || 0) < 28 * 864e5 ? +p.rkFrame.r || 0 : 0;
  return { uid: u.id, name: String(p.name || u.name || '').slice(0, 40), color: p.color || null, av: p.avatar || null, cls: u.cls || p.cls || 'sd1', cid: u.classId || null,
    w: wk.id || null, wxp: +wk.xp || 0, pw: (p.wkPrev && p.wkPrev.id) || null, pwxp: (p.wkPrev && +p.wkPrev.xp) || 0, ppw: (p.wkPrev2 && p.wkPrev2.id) || null, ppx: (p.wkPrev2 && +p.wkPrev2.xp) || 0,
    mo: MO, mact: new Set(days.filter((d) => String(d).startsWith(MO))).size, pmo: PMO, pmact: new Set(days.filter((d) => String(d).startsWith(PMO))).size,
    st, bst: Math.max(+p.bestStreak || 0, st), xp: +u.xp || +p.xp || 0, mxp, fr, created: +u.created || +p.created || 0, upd: +u.upd || 0 };
}

if (DRY) {
  const d = JSON.parse(fs.readFileSync(process.env.RK_DATA, 'utf8'));
  d.rk.forEach((e) => { S.rk[e.uid] = e; }); d.cls.forEach((c) => { S.cls[c.id] = c; });
  (d.users || []).forEach((u) => { const e = fromUser(u); if (e) S.usr[u.id] = e; else delete S.usr[u.id]; });
  (d.ref || []).forEach((r) => { S.ref[r.id] = r; });
} else {
  const rk = await since('rk', S.rkLast);
  rk.forEach((e) => { if (e.uid && e.uid === e.id) { S.rk[e.uid] = e; S.rkLast = Math.max(S.rkLast, +e.upd || 0); } });
  const cls = await since('classes', S.clsLast, ['school', 'label', 'cls', 'name', 'members', 'teacherUid', 'upd']);
  cls.forEach((c) => { S.cls[c.id] = { id: c.id, school: c.school || '', label: c.label || '', cls: c.cls || '', tname: c.name || '', n: c.members && typeof c.members === 'object' ? Object.keys(c.members).length : 0 }; S.clsLast = Math.max(S.clsLast, +c.upd || 0); });
  const us = await since('users', S.usrLast, ['role', 'classId', 'created', 'disabled', 'name', 'cls', 'xp', 'p', 'upd']);
  us.forEach((u) => { const e = fromUser(u); if (e) S.usr[u.id] = e; else delete S.usr[u.id]; S.usrLast = Math.max(S.usrLast, +u.upd || 0); });
  const rf = await since('ref', S.refLast).catch(() => []);
  rf.forEach((r) => { if (r.uid && r.by && r.uid === r.id) S.ref[r.id] = r; S.refLast = Math.max(S.refLast, +r.upd || 0); });
  console.log(`Akun berubah: ${us.length}, total murid ${Object.keys(S.usr).length}, ajakan ${rf.length}.`);
  console.log(`Entri baru: ${rk.length}, kelas berubah: ${cls.length}; total entri ${Object.keys(S.rk).length}, kelas ${Object.keys(S.cls).length}.`);
}

// ---------- bantuan ----------
const JEN = (c) => { c = String(c || ''); const g = /^k(\d+)$/.exec(c); if (g) { const n = +g[1]; return n <= 6 ? 'sd' : n <= 9 ? 'smp' : 'sma'; } return c === 'tk' ? 'tk' : /^sd/.test(c) ? 'sd' : c === 'smp' ? 'smp' : c === 'sma' ? 'sma' : 'sd'; };
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const clsOf = (e) => (e.cid && S.cls[e.cid]) || null;
const schOf = (e) => { const c = clsOf(e); return c && slug(c.school) ? slug(c.school) : null; };
const row = (e, v, v2) => { const c = clsOf(e); return { u: e.uid, n: String(e.name || '').slice(0, 40), c: e.color || null, a: e.av || null, k: c ? c.label : '', s: c ? c.school : '', j: JEN(e.cls), v, ...(v2 != null ? { v2 } : {}), ...(e.fr ? { fr: e.fr } : {}) }; };
const ENT = (() => { const m = {};
  Object.values(S.usr).forEach((e) => { m[e.uid] = { ...e }; });
  Object.values(S.rk).forEach((e) => { if (!e || !e.uid) return; const u = m[e.uid]; if (!u) { if ((+e.upd || 0) > NOW.getTime() - 120 * 864e5) m[e.uid] = { ...e }; return; }
    if ((+e.upd || 0) > (+u.upd || 0)) Object.assign(u, e, { xp: Math.max(+e.xp || 0, +u.xp || 0), mxp: e.mo === MO && e.mxp != null ? Math.max(+e.mxp, +u.mxp || 0) : u.mxp }); });
  return Object.values(m); })();
const xpOf = (e, wk) => e.w === wk ? +e.wxp || 0 : e.pw === wk ? +e.pwxp || 0 : e.ppw === wk ? +e.ppx || 0 : 0;
const actOf = (e, mo) => e.mo === mo ? +e.mact || 0 : e.pmo === mo ? +e.pmact || 0 : 0;
function boards(list, wk, pwk, mo, lim, zeros) {
  const top = (arr) => arr.sort((a, b) => b.v - a.v || (b.v2 || 0) - (a.v2 || 0)).slice(0, lim);
  const mx = (e) => e.mo === mo ? +e.mxp || 0 : 0;
  return {
    xp: top(list.map((e) => row(e, xpOf(e, wk), +e.xp || 0)).filter((r) => zeros || r.v > 0)),
    xpm: top(list.map((e) => row(e, mx(e), +e.xp || 0)).filter((r) => zeros || r.v > 0)),
    xpt: top(list.map((e) => row(e, +e.xp || 0)).filter((r) => r.v > 0)),
    naik: top(list.map((e) => { const a = xpOf(e, wk), b = xpOf(e, pwk); return b >= 20 && a > b ? row(e, a - b, a) : null; }).filter(Boolean)),
    act: top(list.map((e) => row(e, actOf(e, mo))).filter((r) => r.v > 0)),
    str: top(list.map((e) => row(e, +e.bst || 0, +e.st || 0)).filter((r) => r.v > 0)),
  };
}
function klsRank(classIds, wk) {
  const by = {}; ENT.forEach((e) => { if (e.cid && classIds.has(e.cid)) { const x = xpOf(e, wk); const b = by[e.cid] = by[e.cid] || { tot: 0, act: 0 }; b.tot += x; if (x > 0) b.act++; } });
  return Object.entries(by).filter(([, b]) => b.act >= 2).map(([cid, b]) => { const c = S.cls[cid] || {}; const m = Math.max(3, c.n || 0, b.act); return { cid, n: c.label || 'Kelas', s: c.school || '', t: c.tname || '', v: Math.round(b.tot / m), tot: b.tot, m: b.act }; })
    .sort((a, b) => b.v - a.v || b.tot - a.tot);
}

// ---------- susun papan saat ini ----------
const writes = {};
const byJ = {}, bySch = {}, byCls = {};
ENT.forEach((e) => { (byJ[JEN(e.cls)] = byJ[JEN(e.cls)] || []).push(e); const s = schOf(e); if (s) (bySch[s] = bySch[s] || []).push(e); if (e.cid && S.cls[e.cid]) (byCls[e.cid] = byCls[e.cid] || []).push(e); });
const allCls = new Set(Object.keys(byCls));
const klsJ = {}; ['tk', 'sd', 'smp', 'sma'].forEach((j) => { klsJ[j] = klsRank(new Set([...allCls].filter((cid) => JEN(S.cls[cid].cls) === j)), W); });
const klsS = {}; Object.keys(bySch).forEach((s) => { klsS[s] = klsRank(new Set([...allCls].filter((cid) => slug(S.cls[cid].school) === s)), W); });
const meta = { w: W, mo: MO, at: NOW.getTime() };
['tk', 'sd', 'smp', 'sma'].forEach((j) => { writes['nas_' + j] = { ...meta, j, b: boards(byJ[j] || [], W, PW, MO, 100, true), kls: klsJ[j].slice(0, 50), last: S.lastW['nas_' + j] || null, lastM: S.lastM['nas_' + j] || null }; });
{ const klsAll = klsRank(allCls, W); writes.nas_all = { ...meta, j: 'all', b: boards(ENT, W, PW, MO, 100, true), kls: klsAll.slice(0, 50), last: S.lastW.nas_all || null, lastM: S.lastM.nas_all || null }; }
Object.entries(bySch).forEach(([s, list]) => { const nm = clsOf(list[0]).school; writes['sch_' + s] = { ...meta, s: nm, b: boards(list, W, PW, MO, 100, true), kls: klsS[s].slice(0, 50), last: S.lastW['sch_' + s] || null, lastM: S.lastM['sch_' + s] || null }; });
Object.entries(byCls).forEach(([cid, list]) => {
  const c = S.cls[cid], j = JEN(c.cls), s = slug(c.school);
  const rs = s && klsS[s] ? klsS[s].findIndex((x) => x.cid === cid) + 1 : 0, rn = klsJ[j].findIndex((x) => x.cid === cid) + 1;
  writes['cls_' + cid] = { ...meta, k: c.label, s: c.school, sch: s || null, j, b: boards(list, W, PW, MO, 300, true), rs, ns: s && klsS[s] ? klsS[s].length : 0, rn, nn: klsJ[j].length, last: S.lastW['cls_' + cid] || null, lastM: S.lastM['cls_' + cid] || null };
});

// ---------- penutupan minggu / bulan: penghargaan juara ----------
const awards = {}; // uid -> [award]
const give = (uid, a) => { (awards[uid] = awards[uid] || []).push(a); };
// juara hanya diumumkan bila pesertanya cukup, supaya gelar tetap bermakna
const MINP = { nasional: 10, sekolah: 5, kelas: 3 };
const cnt = (list, f) => list.filter(f).length;
const G = { nasional: [100, 70, 50], sekolah: [50, 35, 25], kelas: [30, 20, 10] };
const MN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const wLabel = (wk) => { const d = new Date(wk + 'T00:00:00Z'), e = new Date(d.getTime() + 6 * 864e5); return `${d.getUTCDate()} ${MN[d.getUTCMonth()].slice(0, 3)}–${e.getUTCDate()} ${MN[e.getUTCMonth()].slice(0, 3)} ${e.getUTCFullYear()}`; };
const mLabel = (mo) => `${MN[+mo.slice(5) - 1]} ${mo.slice(0, 4)}`;
const top3 = (b) => (b || []).slice(0, 3).map((r) => ({ u: r.u, n: r.n, a: r.a, c: r.c, v: r.v }));
let nAw = 0;
if (S.finW !== PW && hrsIntoWeek >= 3) {
  const per = wLabel(PW);
  const scopes = [];
  ['tk', 'sd', 'smp', 'sma'].forEach((j) => scopes.push({ id: 'nas_' + j, sc: 'nasional', lbl: 'Nasional ' + j.toUpperCase(), list: byJ[j] || [], g: G.nasional }));
  scopes.push({ id: 'nas_all', sc: 'nasional', lbl: 'Semua JELAS', list: ENT, g: G.nasional });
  Object.entries(bySch).forEach(([s, list]) => scopes.push({ id: 'sch_' + s, sc: 'sekolah', lbl: clsOf(list[0]).school, list, g: G.sekolah }));
  Object.entries(byCls).forEach(([cid, list]) => scopes.push({ id: 'cls_' + cid, sc: 'kelas', lbl: S.cls[cid].label || 'Kelas', sub: S.cls[cid].school, list, g: G.kelas }));
  for (const sc of scopes) {
    const b = boards(sc.list, PW, PPW, PMO, 3);
    if (cnt(sc.list, (e) => xpOf(e, PW) > 0) < MINP[sc.sc]) { b.xp = []; b.naik = []; }
    if (cnt(sc.list, (e) => xpOf(e, PW) > 0 && xpOf(e, PPW) >= 20) < 5) b.naik = [];
    b.xp.forEach((r, i) => give(r.u, { id: `${PW}:${sc.id}:xp`, p: per, sc: sc.sc, lbl: sc.lbl, sub: sc.sub || r.s || '', m: 'xp', r: i + 1, v: r.v, g: sc.g[i] }));
    b.naik.slice(0, sc.sc === 'nasional' ? 3 : 1).forEach((r, i) => give(r.u, { id: `${PW}:${sc.id}:naik`, p: per, sc: sc.sc, lbl: sc.lbl, sub: sc.sub || r.s || '', m: 'naik', r: i + 1, v: r.v, g: 20 }));
    S.lastW[sc.id] = { w: PW, p: per, xp: top3(b.xp), naik: top3(b.naik) };
  }
  // kelas juara: anggota kelas terbaik nasional (per jenjang) dan terbaik di tiap sekolah
  const klsPrev = (ids) => klsRank(ids, PW);
  ['tk', 'sd', 'smp', 'sma'].forEach((j) => { const r = klsPrev(new Set([...allCls].filter((cid) => JEN(S.cls[cid].cls) === j))); if (S.lastW['nas_' + j]) S.lastW['nas_' + j].kls = r.slice(0, 3);
    if (r.length >= 3) r.slice(0, 1).forEach((k) => (byCls[k.cid] || []).forEach((e) => { if (xpOf(e, PW) > 0) give(e.uid, { id: `${PW}:klsnas_${j}`, p: per, sc: 'nasional', lbl: 'Nasional ' + j.toUpperCase(), sub: k.n + ' · ' + k.s, m: 'kls', r: 1, v: k.v, g: 30 }); })); });
  Object.keys(bySch).forEach((s) => { const r = klsPrev(new Set([...allCls].filter((cid) => slug(S.cls[cid].school) === s))); if (S.lastW['sch_' + s]) S.lastW['sch_' + s].kls = r.slice(0, 3);
    if (r.length >= 2) (byCls[r[0].cid] || []).forEach((e) => { if (xpOf(e, PW) > 0) give(e.uid, { id: `${PW}:klssch_${s}`, p: per, sc: 'sekolah', lbl: r[0].s, sub: r[0].n, m: 'kls', r: 1, v: r[0].v, g: 15 }); }); });
  S.finW = PW; nAw += 1;
}
if (S.finM !== PMO && hrsIntoMonth >= 3) {
  const per = mLabel(PMO);
  const scopes = [];
  ['tk', 'sd', 'smp', 'sma'].forEach((j) => scopes.push({ id: 'nas_' + j, sc: 'nasional', lbl: 'Nasional ' + j.toUpperCase(), list: byJ[j] || [], g: G.nasional }));
  scopes.push({ id: 'nas_all', sc: 'nasional', lbl: 'Semua JELAS', list: ENT, g: G.nasional });
  Object.entries(bySch).forEach(([s, list]) => scopes.push({ id: 'sch_' + s, sc: 'sekolah', lbl: clsOf(list[0]).school, list, g: G.sekolah }));
  Object.entries(byCls).forEach(([cid, list]) => scopes.push({ id: 'cls_' + cid, sc: 'kelas', lbl: S.cls[cid].label || 'Kelas', sub: S.cls[cid].school, list, g: G.kelas }));
  for (const sc of scopes) {
    const b = boards(sc.list, W, PW, PMO, 3);
    if (cnt(sc.list, (e) => actOf(e, PMO) > 0) < MINP[sc.sc]) b.act = [];
    b.act.forEach((r, i) => give(r.u, { id: `${PMO}:${sc.id}:act`, p: per, sc: sc.sc, lbl: sc.lbl, sub: sc.sub || r.s || '', m: 'act', r: i + 1, v: r.v, g: sc.g[i] }));
    S.lastM[sc.id] = { mo: PMO, p: per, act: top3(b.act) };
  }
  S.finM = PMO; nAw += 1;
}
// penutupan baru saja terjadi: perbarui "last" di papan yang ditulis
if (nAw) Object.keys(writes).forEach((id) => { writes[id].last = S.lastW[id] || null; writes[id].lastM = S.lastM[id] || null; });

// ---------- ajak teman: hadiah untuk pengajak dan teman baru setelah teman baru belajar ----------
let nRef = 0;
for (const r of Object.values(S.ref)) {
  if (S.refDone[r.uid]) continue;
  const nu = S.usr[r.uid], by = S.usr[r.by];
  if (!nu || !by || r.by === r.uid) { if (NOW.getTime() - (+r.at || 0) > 30 * 864e5) S.refDone[r.uid] = 'x'; continue; }
  if (nu.created && nu.created < (+r.at || 0) - 7 * 864e5) { S.refDone[r.uid] = 'lama'; continue; } // bukan akun baru
  if ((+nu.xp || 0) < 20) continue; // tunggu sampai teman baru benar-benar belajar
  const cntBy = Object.values(S.ref).filter((x) => x.by === r.by && S.refDone[x.uid] === 'ok').length;
  const per = ymd(wit(NOW));
  if (cntBy < 20) give(r.by, { id: 'ajak:' + r.uid, p: per, sc: 'ajak', lbl: 'Ajak teman', sub: nu.name, m: 'ajak', r: 0, v: 0, g: 50 });
  give(r.uid, { id: 'ajak:' + r.uid, p: per, sc: 'ajak', lbl: 'Diajak teman', sub: by.name, m: 'ajak', r: 0, v: 0, g: 25 });
  S.refDone[r.uid] = 'ok'; nRef++;
}

// permata: tiap murid hanya mendapat permata dari gelar terbaiknya per periode (gelar lain tetap dicatat)
Object.values(awards).forEach((list) => { const per = {}; list.forEach((a) => { if (a.m === 'ajak') return; const k = a.id.split(':')[0]; if (!per[k] || a.g > per[k].g) per[k] = a; }); list.forEach((a) => { if (a.m !== 'ajak' && per[a.id.split(':')[0]] !== a) a.g = 0; }); });

// ---------- tulis ----------
const h = (s) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };
let nW = 0;
function pack(d) { const P = {}; const b = {};
  Object.entries(d.b || {}).forEach(([m, list]) => { b[m] = list.map((r) => { if (!P[r.u]) P[r.u] = { n: r.n, c: r.c, a: r.a, k: r.k, s: r.s, ...(r.fr ? { fr: r.fr } : {}) }; return r.v2 != null ? [r.u, r.v, r.v2] : [r.u, r.v]; }); });
  return { ...d, b, P }; }
for (const [id, d0] of Object.entries(writes)) {
  const d = pack(d0);
  const body = JSON.stringify({ ...d, at: 0 }), hv = h(body);
  if (S.hash[id] === hv && NOW.getTime() - (S.hash[id + '@'] || 0) < 6 * 3600e3) continue;
  const doc = { d: JSON.stringify(d), upd: NOW.getTime() };
  if (DRY) { fs.mkdirSync('/tmp/rkout', { recursive: true }); fs.writeFileSync('/tmp/rkout/' + id + '.json', JSON.stringify(d, null, 1)); }
  else { try { await C.patchDoc('rkb/' + id, doc); } catch (e) { console.log('tulis papan gagal:', e.message.slice(0, 120)); continue; } }
  S.hash[id] = hv; S.hash[id + '@'] = NOW.getTime(); nW++;
}
let nU = 0;
for (const [uid, list] of Object.entries(awards)) {
  if (DRY) { fs.mkdirSync('/tmp/rkout', { recursive: true }); fs.writeFileSync('/tmp/rkout/aw_' + uid + '.json', JSON.stringify(list, null, 1)); nU++; continue; }
  try {
    const cur = await C.getDoc('rkw/' + uid).catch(() => null); let old = []; try { old = JSON.parse((cur && cur.d) || '[]'); } catch (_) {}
    const ids = new Set(old.map((a) => a.id)); const add = list.filter((a) => !ids.has(a.id));
    if (!add.length) continue;
    await C.patchDoc('rkw/' + uid, { d: JSON.stringify([...old, ...add].slice(-40)), upd: NOW.getTime() }); nU++;
  } catch (e) { console.log('penghargaan gagal:', e.message.slice(0, 120)); }
}
console.log(`Papan ditulis: ${nW} dari ${Object.keys(writes).length}. Penerima penghargaan: ${nU}. Ajakan berhasil: ${nRef}. Minggu ${W}${nAw ? ' (penutupan dijalankan)' : ''}.`);
if (!DRY || process.env.RK_SAVE) { fs.mkdirSync('.rkcache', { recursive: true }); fs.writeFileSync(DRY ? process.env.RK_SAVE : CF, JSON.stringify(S)); }
