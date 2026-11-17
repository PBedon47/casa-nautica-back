const GRAPH = process.env.WA_GRAPH_VERSION || 'v23.0';
const phoneWA = p => { const d = String(p).replace(/\D/g, ''); return d.length === 9 ? '51' + d : d; };

const sendInvitacion = async (phone, name) => {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${process.env.WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.WA_TOKEN}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: phoneWA(phone), type: 'template',
      template: {
        name: process.env.WA_TEMPLATE || 'registro_exitoso', language: { code: 'es' },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { link: `${process.env.PUBLIC_URL}/invitacion-registro.jpg` } }] },
          { type: 'body', parameters: [{ type: 'text', text: name }] }
        ]
      }
    })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d?.error?.message || 'Error al enviar WhatsApp');
  return d;
};

module.exports = { sendInvitacion };