require('dotenv').config();
const express = require('express'), cors = require('cors'), nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient(), app = express();
app.use(cors(), express.json());
const CAP = 18;
const mailer = process.env.SMTP_USER ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }) : null;
const ev = () => db.event.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
const admin = (q, s, n) => q.headers['x-admin-pin'] === process.env.ADMIN_PIN ? n() : s.status(401).json({ error: 'PIN incorrecto' });
const tally = (guests, f) => guests.reduce((a, g) => { g[f].split(',').filter(Boolean).forEach(k => a[k] = (a[k] || 0) + 1); return a; }, {});

const invite = (g, e) => ({
  from: `Casa Náutica 🌴 <${process.env.SMTP_USER}>`, to: g.email,
  subject: '🌴 Estás dentro: el 13 y 14 va a ser un día GOOD 😎',
  html: `<div style="font-family:Arial;max-width:480px;margin:auto;background:#e6f9ff;border-radius:20px;padding:28px;text-align:center;color:#073b4c">
  <h1>🌴 ¡Estás dentro, ${g.name}!</h1><h2 style="color:#ff9f43">El 13 y 14 de diciembre va a ser un día GOOD 😎</h2>
  <p>Sol, piscina, parrilla y buena música.<br><b>Casa Náutica · Santa Rosa, Ancón</b><br>Ingreso 2pm · Salida 11am</p>
  <p>Cuota de la casa: <b>S/ ${e.houseFee}</b></p><p>Trae: traje de baño 🩳, bloqueador 🧴 y muchas ganas de pasarla bien 🏖️</p><p>¡Nos vemos en la playa!</p></div>`
});

app.get('/api/event', async (_, res) => {
  const [event, guests] = await Promise.all([ev(), db.guest.findMany({ orderBy: { createdAt: 'asc' } })]);
  const yes = guests.filter(g => g.going);
  res.json({ event, cap: CAP, going: yes.map(g => g.name), votes: { music: tally(yes, 'music'), food: tally(yes, 'food') } });
});

app.post('/api/rsvp', async (q, s) => {
  const b = q.body, name = String(b.name || '').trim().slice(0, 40), going = !!b.going;
  if (name.length < 2) return s.status(400).json({ error: 'Escribe tu nombre' });
  const nameKey = name.toLowerCase(), cur = await db.guest.findUnique({ where: { nameKey } });
  if (going && !cur?.going && (await db.guest.count({ where: { going: true } })) >= CAP) return s.status(409).json({ error: 'La casa ya está llena 😢' });
  const clean = v => String(v || '').trim().slice(0, 80);
  const data = { name, going, email: going ? clean(b.email) : '', phone: going ? clean(b.phone).replace(/\D/g, '') : '',
    music: going ? (Array.isArray(b.music) ? b.music.map(clean).join(',') : '') : '', food: going ? clean(b.food) : '' };
  const g = await db.guest.upsert({ where: { nameKey }, update: data, create: { ...data, nameKey } });
  let emailed = false;
  if (going && g.email && mailer && g.email !== cur?.email) {
    try { await mailer.sendMail(invite(g, await ev())); emailed = true; } catch (e) { console.error('Correo:', e.message); }
  }
  s.json({ ok: true, emailed });
});

app.get('/api/admin/guests', admin, async (_, s) => s.json(await db.guest.findMany({ orderBy: { createdAt: 'asc' } })));
app.patch('/api/admin/guests/:id', admin, async (q, s) => s.json(await db.guest.update({ where: { id: +q.params.id }, data: { paidHouse: q.body.paidHouse, paidExtra: q.body.paidExtra } })));
app.delete('/api/admin/guests/:id', admin, async (q, s) => { await db.guest.delete({ where: { id: +q.params.id } }); s.json({ ok: true }); });
app.put('/api/admin/event', admin, async (q, s) => s.json(await db.event.update({ where: { id: 1 }, data: { extraFee: +q.body.extraFee || 0, houseFee: +q.body.houseFee || 50 } })));
app.listen(process.env.PORT || 4000, () => console.log('API lista 🌊'));
