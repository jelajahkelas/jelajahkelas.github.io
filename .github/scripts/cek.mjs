// Diagnosa akun (hanya membaca): cari akun berdasarkan nama pengguna dan nama.
import { GoogleAuth } from 'google-auth-library';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/identitytoolkit'] });
const cl = await auth.getClient();
const P = sa.project_id, FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const user = (process.env.CEK_USER || 'farid').toLowerCase(), nama = (process.env.CEK_NAMA || 'farid').toLowerCase();
const val = (v) => v == null ? null : v.stringValue ?? v.integerValue ?? v.doubleValue ?? v.booleanValue ?? v.timestampValue ?? (v.nullValue !== undefined ? null : (v.mapValue ? '{map}' : v.arrayValue ? '[arr]' : '?'));
const get = async (p) => { try { const r = await cl.request({ url: `${FS}/${p}` }); return r.data; } catch (e) { return { err: e.response && e.response.status }; } };
const show = (d) => d && d.fields ? Object.fromEntries(Object.entries(d.fields).filter(([k]) => !/token|fcm|pw|pass|pin/i.test(k)).map(([k, v]) => [k, val(v)])) : d;
console.log('handles/' + user, JSON.stringify(show(await get('handles/' + user))));
console.log('recovery/' + user, (await get('recovery/' + user)).fields ? 'ADA' : 'tidak ada');
const lk = async (body) => { try { const r = await cl.request({ url: `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:lookup`, method: 'POST', data: body }); return r.data.users || []; } catch (e) { return 'ERR ' + JSON.stringify(e.response && e.response.data || e.message).slice(0, 300); } };
const au = await lk({ email: [`${user}@murid.jelajahkelas.app`] });
console.log('auth murid', JSON.stringify(Array.isArray(au) ? au.map(u => ({ uid: u.localId, email: u.email, created: u.createdAt, lastLogin: u.lastLoginAt, disabled: u.disabled })) : au));
// cari di koleksi users berdasarkan username / nama
let tok = '', n = 0; const hits = [];
do { const r = await cl.request({ url: `${FS}/users?pageSize=300${tok ? '&pageToken=' + tok : ''}&mask.fieldPaths=username&mask.fieldPaths=name&mask.fieldPaths=role&mask.fieldPaths=created&mask.fieldPaths=lastSeen` });
  for (const d of r.data.documents || []) { n++; const f = show(d); if (String(f.username || '').toLowerCase() === user || String(f.name || '').toLowerCase().includes(nama)) hits.push({ id: d.name.split('/').pop(), ...f, updated: d.updateTime }); }
  tok = r.data.nextPageToken || ''; } while (tok);
console.log('jumlah users', n); console.log('cocok', JSON.stringify(hits, null, 1));
for (const h of hits) { const a = await lk({ localId: [h.id] }); console.log('auth', h.id, JSON.stringify(Array.isArray(a) ? a.map(u => ({ email: u.email, lastLogin: u.lastLoginAt, disabled: u.disabled })) : a)); }
