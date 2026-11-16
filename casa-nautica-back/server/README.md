# Backend Casa Náutica
1. Crea las tablas con el zip `db` (schema.sql).
2. cp .env.example .env  → pega DATABASE_URL, cambia ADMIN_PIN, (opcional) SMTP_USER/SMTP_PASS para enviar el correo de invitación.
3. npm install   (genera el cliente Prisma)
4. npm run dev   → http://localhost:4000
Deploy: Render/Railway con las mismas variables (build: npm install, start: npm start).
WhatsApp: la invitación se abre con un botón (wa.me) en la web y en el panel admin. El envío 100% automático por WhatsApp exige la API oficial de Meta (cuenta Business y plantillas aprobadas), por eso aquí no se usa.
