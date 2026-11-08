// Pengirim notifikasi cadangan JELAS (berjalan di GitHub Actions setiap ±10 menit).
// Memakai kode server notifikasi yang sama (notif/worker.js) dan kunci FIREBASE_SERVICE_ACCOUNT di GitHub Secrets.
// Tugasnya:
//  1. Mengirim notifikasi yang antre di koleksi "pushq" (ditulis aplikasi jika server Cloudflare belum siap).
//  2. Pengingat tugas terjadwal (sama dengan Cron Cloudflare).
//  3. Pengingat runtunan sekali sehari pukul 19.00 WITA untuk murid yang belum belajar hari itu.
import fs from 'node:fs';

const src = fs.readFileSync('notif/worker.js', 'utf8').replace('export default {', 'const __default = {')
  + '\nexport { pushTo, getDoc, pushTask, listDocs, deleteDoc, reminders, patchDoc, accessToken };\nexport function setSA(x) { SA = x; }\n';
fs.writeFileSync('/tmp/jelas-core.mjs', src);
const C = await import('/tmp/jelas-core.mjs');
const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.log('FIREBASE_SERVICE_ACCOUNT belum ada.'); process.exit(0); }
const SA = JSON.parse(raw);
C.setSA(SA);
const base = `https://firestore.googleapis.com/v1/projects/${SA.project_id}/databases/(default)/documents/`;
const MODE = process.argv[2] || 'run';

async function listAll(col, mask) {
  const out = []; let page = '';
  const val = (f) => f == null ? null : f.stringValue ?? f.integerValue ?? f.doubleValue ?? f.booleanValue
    ?? (f.arrayValue ? (f.arrayValue.values || []).map(val) : f.mapValue ? Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, val(v)])) : null);
  do {
    const m = (mask || []).map((k) => '&mask.fieldPaths=' + encodeURIComponent(k)).join('');
    const r = await fetch(`${base}${col}?pageSize=300${m}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, { headers: { Authorization: 'Bearer ' + await C.accessToken() } });
    const j = await r.json();
    if (!r.ok) throw new Error(col + ' ' + r.status + ' ' + JSON.stringify(j).slice(0, 300));
    (j.documents || []).forEach((d) => { const o = { id: d.name.split('/').pop() }; Object.entries(d.fields || {}).forEach(([k, v]) => { o[k] = val(v); }); out.push(o); });
    page = j.nextPageToken || '';
  } while (page);
  return out;
}

if (MODE === 'cek') {
  // Uji izin kunci: baca Firestore dan kirim uji coba FCM (validate_only, tidak benar-benar terkirim).
  const users = await listAll('users', ['push', 'role']);
  const withPush = users.filter((u) => Array.isArray(u.push) && u.push.length);
  console.log(`Firestore OK: ${users.length} pengguna, ${withPush.length} punya izin notifikasi.`);
  if (withPush.length) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${SA.project_id}/messages:send`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + await C.accessToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ validate_only: true, message: { token: withPush[0].push.slice(-1)[0], data: { type: 'cek', title: 'cek' } } }),
    });
    console.log('FCM uji coba:', r.status, r.ok ? 'OK' : (await r.text()).slice(0, 300));
  }
  process.exit(0);
}

let sent = 0;
// 1. antrean notifikasi
const q = await listAll('pushq').catch((e) => { console.log('pushq:', e.message); return []; });
for (const it of q) {
  await C.deleteDoc('pushq/' + it.id);
  const uid = it.uid, id = String(it.id2 || it.ref || '');
  try {
    if (Date.now() - (+it.created || 0) > 3 * 3600e3) continue; // sudah terlalu lama
    if (it.type === 'follow') {
      const d = await C.getDoc('fol/' + id);
      if (d && d.from === uid) sent += await C.pushTo(d.to, { type: 'follow', title: `${d.fromName || 'Seseorang'} mulai mengikutimu`, body: 'Buka JELAS untuk mengikuti balik.' });
    } else if (it.type === 'nudge') {
      const d = await C.getDoc('fq/' + id);
      if (d && (d.members || []).includes(uid)) {
        const other = d.members.find((x) => x !== uid), nm = (d.names || {})[uid] || 'Temanmu';
        sent += await C.pushTo(other, { type: 'nudge', title: `${nm} mencolekmu! 👋`, body: 'Ayo selesaikan misi teman minggu ini.' });
      } else {
        const f = await C.getDoc('fs/' + id);
        if (f && (f.m || []).includes(uid)) {
          const other = f.m.find((x) => x !== uid), nm = ((f.info || {})[uid] || {}).name || 'Temanmu';
          sent += await C.pushTo(other, { type: 'nudge', title: `${nm} mencolekmu! 🔥`, body: 'Jaga runtunan teman kalian. Belajar sebentar hari ini, yuk!' });
        }
      }
    } else if (it.type === 'fsinv') {
      const f = await C.getDoc('fs/' + id);
      if (f && f.from === uid) {
        const other = (f.m || []).find((x) => x !== uid), nm = ((f.info || {})[uid] || {}).name || 'Temanmu';
        if (other) sent += await C.pushTo(other, { type: 'fsinv', title: `${nm} memilihmu jadi teman runtunan! 🔥`, body: 'Belajar tiap hari bersama supaya api kalian tetap menyala.' });
      }
    } else if (it.type === 'task') {
      const cid = String(it.cid || ''), tid = String(it.tid || '');
      if ((cid === uid || cid.startsWith(uid + '_')) && /^[A-Za-z0-9_-]{4,120}$/.test(tid)) {
        const t = await C.getDoc(`classes/${cid}/tasks/${tid}`);
        if (t) sent += await C.pushTask(cid, tid, { type: 'task', tid, title: `Tugas baru: ${t.title || ''}`, body: `${t.subjName || ''} · ${t.n || ''} soal · batas ${t.due || ''}. Yuk kerjakan!` }, true);
      }
    } else if (it.type === 'answer') {
      const inv = await C.getDoc('invites/' + id);
      if (inv && inv.to === uid && inv.status) {
        const who = inv.toName || 'Temanmu';
        sent += inv.status === 'declined'
          ? await C.pushTo(inv.from, { type: 'declined', title: `${who} menolak tantanganmu`, body: 'Coba ajak teman lain, atau tantang lagi nanti.' })
          : await C.pushTo(inv.from, { type: 'accepted', code: inv.code, title: `${who} menerima tantanganmu!`, body: 'Buka JELAS dan mulai tandingnya.' });
      }
    } else if (it.type === 'invite') {
      const inv = await C.getDoc('invites/' + id);
      const left = inv ? Math.round((120000 - (Date.now() - (inv.created || 0))) / 1000) : 0;
      if (inv && inv.from === uid && left > 15) sent += await C.pushTo(inv.to, { type: 'invite', inv: id, code: inv.code, exp: (inv.created || Date.now()) + 120000, title: `${inv.fromName || 'Temanmu'} menantangmu tanding${inv.subjName ? ' ' + inv.subjName : ''}!`, body: 'Kamu punya 2 menit untuk menerima tantangan' }, left);
    }
  } catch (e) { console.log('gagal', it.type, e.message); }
}
console.log(`Antrean: ${q.length} permintaan, ${sent} notifikasi terkirim.`);

// 2. pengingat tugas
try { await C.reminders(); } catch (e) { console.log('pengingat tugas:', e.message); }

// 3. pengingat runtunan, sekali sehari mulai pukul 19.00 WITA (UTC+8)
const wita = new Date(Date.now() + 8 * 3600e3), today = wita.toISOString().slice(0, 10);
if (wita.getUTCHours() >= 19 && wita.getUTCHours() < 22) {
  const log = await C.getDoc('config/pushlog').catch(() => null);
  if (!log || log.streak !== today) {
    await C.patchDoc('config/pushlog', { streak: today });
    const users = await listAll('users', ['push', 'role', 'p', 'name']);
    let n = 0;
    for (const u of users) {
      if (u.role !== 'student' || !Array.isArray(u.push) || !u.push.length) continue;
      let p = {}; try { p = JSON.parse(u.p || '{}'); } catch (_) {}
      const st = +p.streak || 0;
      if (st < 1 || p.lastDay === today) continue;
      n += await C.pushTo(u.id, { type: 'streak', title: `🔥 Runtunan ${st} hari hampir padam!`, body: 'Selesaikan satu pelajaran sebelum tengah malam supaya apimu tetap menyala.' }, 4 * 3600);
    }
    console.log(`Pengingat runtunan: ${n} notifikasi.`);
  }
}
