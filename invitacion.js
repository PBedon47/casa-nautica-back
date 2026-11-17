const sharp = require('sharp')
const path = require('path')

const BASE = path.join(__dirname, 'assets', 'base-invitacion.jpg')
const esc = s => String(s).replace(/[<>&"']/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]))

const seg = new Intl.Segmenter('es', { granularity: 'grapheme' })
const EMOJI = /\p{Extended_Pictographic}/u
const emojiCache = new Map()

// Descarga el emoji como PNG (Twemoji) y lo guarda en memoria
async function emojiPng(g) {
  let cps = [...g].map(c => c.codePointAt(0).toString(16))
  if (!cps.includes('200d')) cps = cps.filter(c => c !== 'fe0f')
  const key = cps.join('-')
  if (emojiCache.has(key)) return emojiCache.get(key)
  try {
    const r = await fetch(`https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${key}.png`)
    const buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null
    emojiCache.set(key, buf)
    return buf
  } catch { return null }
}

// Arma la línea del nombre (texto + emojis) centrada, y devuelve las capas
async function capaNombre(nombre, size, ancho, centroY) {
  const GAP = 8
  let piezas = []
  for (const { segment: g } of seg.segment(nombre)) {
    if (EMOJI.test(g)) {
      if (piezas.filter(p => p.emoji).length >= 5) continue
      const png = await emojiPng(g)
      if (png) piezas.push({ emoji: png })
    } else if (/[\p{L}\p{N}\s.'-]/u.test(g)) {
      const u = piezas[piezas.length - 1]
      if (u && u.text !== undefined) u.text += g
      else piezas.push({ text: g })
    }
  }
  piezas = piezas.map(p => p.text !== undefined ? { text: p.text.trim() } : p)
                 .filter(p => p.emoji || p.text)
  if (!piezas.length) piezas = [{ text: 'Invitado' }]

  const render = async s => {
    const out = []
    for (const p of piezas) {
      let buf
      if (p.text !== undefined) {
        buf = await sharp({ text: {
          text: `<span foreground="#fbbf24" font_weight="bold">${esc(p.text)}</span>`,
          font: `Arial ${s}`, rgba: true, dpi: 72
        } }).png().toBuffer()
      } else {
        buf = await sharp(p.emoji).resize({ height: Math.round(s * 1.05) }).png().toBuffer()
      }
      const m = await sharp(buf).metadata()
      out.push({ buf, w: m.width, h: m.height })
    }
    return out
  }
  const ancho_de = it => it.reduce((a, x) => a + x.w, 0) + GAP * (it.length - 1)

  let items = await render(size)
  let total = ancho_de(items)
  if (total > ancho - 80) {            // si es muy largo, lo achica
    items = await render(Math.max(18, Math.floor(size * (ancho - 80) / total)))
    total = ancho_de(items)
  }
  const lineH = Math.max(...items.map(i => i.h))
  let x = Math.round((ancho - total) / 2)
  return items.map(i => {
    const layer = { input: i.buf, left: x, top: Math.round(centroY - i.h / 2) }
    x += i.w + GAP
    return layer
  })
}

// Genera la imagen con el nombre del invitado
async function crearInvitacion(nombre, cuota = 50) {
  nombre = String(nombre || '').trim() || 'Invitado'

  const { width, height } = await sharp(BASE).metadata()
  const extra = Math.round(width * 0.15)   // franja nueva debajo de la imagen
  const H = height + extra
  const y0 = Math.round(height * 0.94)     // tapa la dirección original

  const base = await sharp(BASE)
    .extend({ bottom: extra, background: '#1a0f4a' })
    .toBuffer()

  const svg = `
  <svg width="${width}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${y0}" width="${width}" height="${H - y0}" fill="#1a0f4a"/>
    <rect x="40" y="${y0 + 4}" width="${width - 80}" height="3" fill="#fbbf24"/>
    <text x="50%" y="${y0 + 104}" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="22" fill="#ffffff">Casa Náutica · Santa Rosa, Ancón · Ingreso 2 pm</text>
    <text x="50%" y="${y0 + 136}" text-anchor="middle" font-family="Arial, sans-serif"
          font-size="22" fill="#ffffff">Cuota de la casa: S/ ${esc(cuota)}</text>
  </svg>`

  const capas = await capaNombre(nombre, 40, width, y0 + 48)

  return sharp(base)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, ...capas])
    .jpeg({ quality: 88 }).toBuffer()
}

// Sube la imagen a WhatsApp y devuelve el media id
async function subirMedia(buffer) {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', 'image/jpeg')
  form.append('file', new Blob([buffer], { type: 'image/jpeg' }), 'invitacion.jpg')

  const r = await fetch(
    `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION}/${process.env.WA_PHONE_ID}/media`,
    { method: 'POST', headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` }, body: form }
  )
  const j = await r.json()
  if (!j.id) throw new Error('Error subiendo imagen: ' + JSON.stringify(j))
  return j.id
}

// Envía la plantilla con la imagen personalizada en el encabezado
async function enviarInvitacion(telefono, nombre, cuota) {
  const mediaId = await subirMedia(await crearInvitacion(nombre, cuota))

  const r = await fetch(
    `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION}/${process.env.WA_PHONE_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WA_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefono.length === 9 ? '51' + telefono : telefono,
        type: 'template',
        template: {
          name: process.env.WA_TEMPLATE,
          language: { code: 'es' }, // debe coincidir con el idioma de la plantilla
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
            { type: 'body', parameters: [{ type: 'text', text: nombre }] }
          ]
        }
      })
    }
  )
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j
}

module.exports = { crearInvitacion, enviarInvitacion }