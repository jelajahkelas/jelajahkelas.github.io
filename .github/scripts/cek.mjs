// Diagnosa akun (hanya membaca). Hasil dienkripsi dengan kunci publik pengembang supaya log publik tidak memuat data pribadi.
import { GoogleAuth } from 'google-auth-library';
import fs from 'node:fs'; import crypto from 'node:crypto';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const auth = new GoogleAuth({ credentials: sa, scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase', 'https://www.googleapis.com/auth/identitytoolkit'] });
const cl = await auth.getClient();
const P = sa.project_id, FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const out = {};
const get = async (p) => { try { const r = await cl.request({ url: `${FS}/${p}` }); return r.data; } catch (e) { return { err: e.response && e.response.status }; } };
for (const p of (process.env.CEK_DOCS || '').split(',').filter(Boolean)) out[p] = await get(p);
const lk = async (body) => { try { const r = await cl.request({ url: `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:lookup`, method: 'POST', data: body }); return (r.data.users || []).map(u => ({ uid: u.localId, email: u.email, created: u.createdAt, lastLogin: u.lastLoginAt, lastRefresh: u.lastRefreshAt, disabled: u.disabled, pwUpdated: u.passwordUpdatedAt, providers: (u.providerUserInfo || []).map(x => x.providerId) })); } catch (e) { return 'ERR ' + (e.response && JSON.stringify(e.response.data) || e.message); } };
for (const id of (process.env.CEK_UIDS || '').split(',').filter(Boolean)) out['auth:' + id] = await lk({ localId: [id] });
const key = crypto.randomBytes(32), iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key, iv);
const enc = Buffer.concat([c.update(JSON.stringify(out)), c.final()]), tag = c.getAuthTag();
const ek = crypto.publicEncrypt({ key: fs.readFileSync('.github/scripts/diag_pub.pem'), oaepHash: 'sha256' }, key);
fs.writeFileSync('diag.json', JSON.stringify({ ek: ek.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), d: enc.toString('base64') }));
console.log('selesai, hasil terenkripsi');
