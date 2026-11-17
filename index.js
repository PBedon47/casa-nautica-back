require('dotenv').config();
const express = require('express'), cors = require('cors'), crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { sendInvitacion } = require('./whatsapp');
const db = new PrismaClient(), app = express();
app.use(cors(), express.json({ limit: '1mb' }));
const CAP = 18, SECRET = process.env.TOKEN_SECRET || 'cambia-esto';
const ev = () => db.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
const tally = (guests, f) => guests.reduce((a, g) => { g[f].split(',').filter(Boolean).forEach(k => a[k] = (a[k] || 0) + 1); return a; }, {});

// Sesiones
const mac = b => crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
const sign = p => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return b + '.' + mac(b); };
const verify = t => { const [b, s] = String(t || '').split('.'); if (!b || !s || s !== mac(b)) return null; try { const p = JSON.parse(Buffer.from(b, 'base64url')); return p.exp > Date.now() ? p : null; } catch { return null; } };
const isAdmin = q => verify((q.headers.authorization || '').replace('Bearer ', ''))?.role === 'admin';
const admin = (q, s, n) => isAdmin(q) ? n() : s.status(401).json({ error: 'Inicia sesión como administrador' });
const guest = (q, s, n) => {
  const code = process.env.INVITE_CODE;
  if (!code || isAdmin(q) || String(q.headers['x-invite-code'] || '').trim().toLowerCase() === code.toLowerCase()) return n();
  s.status(401).json({ error: 'Código de invitación incorrecto' });
};

app.post('/api/login', guest, (_, s) => s.json({ ok: true }));
app.post('/api/admin/login', (q, s) => {
  const { user, pass } = q.body, U = process.env.ADMIN_USER, P = process.env.ADMIN_PASS;
  if (U && P && user === U && pass === P) return s.json({ token: sign({ role: 'admin', exp: Date.now() + 12 * 3600e3 }) });
  s.status(401).json({ error: 'Usuario o contraseña incorrectos' });
});

// Público para invitados: solo nombres de confirmados, nunca pagos ni teléfonos
app.get('/api/event', guest, async (_, res) => {
  const [event, guests] = await Promise.all([ev(), db.guest.findMany({ orderBy: { createdAt: 'asc' } })]);
  const yes = guests.filter(g => g.going);
  res.json({ event, cap: CAP, going: yes.map(g => g.name), votes: { music: tally(yes, 'music'), food: tally(yes, 'food') } });
});

app.post('/api/rsvp', guest, async (q, s) => {
  const b = q.body, name = String(b.name || '').trim().slice(0, 40), going = !!b.going;
  if (name.length < 2) return s.status(400).json({ error: 'Escribe tu nombre' });
  const phone = String(b.phone || '').replace(/\D/g, '').slice(0, 15);
  if (going && phone.length < 9) return s.status(400).json({ error: 'Escribe tu WhatsApp (9 dígitos)' });
  const nameKey = name.toLowerCase(), cur = await db.guest.findUnique({ where: { nameKey } });
  if (going && !cur?.going && (await db.guest.count({ where: { going: true } })) >= CAP) return s.status(409).json({ error: 'La casa ya está llena' });
  const clean = v => String(v || '').trim().slice(0, 80);
  const data = { name, going, phone: going ? phone : '',
    music: going ? (Array.isArray(b.music) ? b.music.map(clean).join(',') : '') : '', food: going ? clean(b.food) : '' };
    await db.guest.upsert({ where: { nameKey }, update: data, create: { ...data, nameKey } });
  if (going && (!cur?.going || cur.phone !== phone)) sendInvitacion(phone, name).catch(e => console.error('WhatsApp:', e.message));
  s.json({ ok: true });
});

app.get('/api/admin/guests', admin, async (_, s) => s.json(await db.guest.findMany({ orderBy: { createdAt: 'asc' } })));
app.post('/api/admin/guests', admin, async (q, s) => {
  const name = String(q.body.name || '').trim().slice(0, 40);
  if (name.length < 2) return s.status(400).json({ error: 'Nombre muy corto' });
  const nameKey = name.toLowerCase();
  s.json(await db.guest.upsert({ where: { nameKey }, update: {}, create: { name, nameKey, going: true } }));
});
app.patch('/api/admin/guests/:id', admin, async (q, s) => {
  const b = q.body, d = {};
  for (const k of ['name', 'phone', 'music', 'food']) if (typeof b[k] === 'string') d[k] = b[k].slice(0, 80);
  for (const k of ['going', 'paidHouse', 'paidExtra']) if (typeof b[k] === 'boolean') d[k] = b[k];
  if (d.name) d.nameKey = d.name.toLowerCase();
  s.json(await db.guest.update({ where: { id: +q.params.id }, data: d }));
});
app.get('/health', (_, s) => s.send('ok'));
app.post('/api/admin/guests/:id/whatsapp', admin, async (q, s) => {
  const g = await db.guest.findUnique({ where: { id: +q.params.id } });
  if (!g || !g.going || !g.phone) return s.status(400).json({ error: 'El invitado no asiste o no tiene WhatsApp' });
  try { await sendInvitacion(g.phone, g.name); s.json({ ok: true }); }
  catch (e) { s.status(502).json({ error: e.message }); }
});
app.listen(process.env.PORT || 4000, () => console.log('API lista'));