const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'CinoX <onboarding@resend.dev>';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

const PORT = 5000;

// Uploads directory
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// Init DB schema
async function initDB() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try { await pool.query(schema); console.log('DB ready'); }
  catch (e) { console.error('DB init error:', e.message); }
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  store: new PgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'cinox-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 30 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

const auth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecté' });
  next();
};

// ====== HELPERS ======
function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

async function sendOTPEmail(toEmail, toName, otp) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[OTP-DEMO] Code pour ${toEmail}: ${otp}`);
    return { demo: true };
  }
  try {
    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [toEmail],
      subject: `${otp} – Votre code de vérification CinoX`,
      html: `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F4F3FF;font-family:'Helvetica Neue',Arial,sans-serif">
  <div style="max-width:480px;margin:40px auto;background:white;border-radius:24px;overflow:hidden;box-shadow:0 8px 32px rgba(108,60,225,0.12)">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6C3CE1,#8B5CF6);padding:32px 32px 24px;text-align:center">
      <div style="display:inline-flex;align-items:center;gap:10px">
        <div style="width:42px;height:42px;background:rgba(255,255,255,0.2);border-radius:14px;display:inline-flex;align-items:center;justify-content:center;font-size:20px">📦</div>
        <span style="font-size:28px;font-weight:900;color:white;letter-spacing:-1px">CinoX</span>
      </div>
      <p style="color:rgba(255,255,255,0.8);margin:10px 0 0;font-size:14px">La marketplace de Madagascar 🇲🇬</p>
    </div>
    <!-- Body -->
    <div style="padding:32px">
      <p style="font-size:16px;color:#0F0A2E;font-weight:600;margin:0 0 8px">Bonjour ${toName || ''} 👋</p>
      <p style="font-size:14px;color:#7B7599;margin:0 0 24px;line-height:1.6">Voici ton code de vérification pour activer ton compte CinoX. Ce code est valable <strong>15 minutes</strong>.</p>
      <!-- OTP Box -->
      <div style="background:linear-gradient(135deg,#F5F3FF,#EDE9FE);border:2px solid #C4A8FF;border-radius:18px;padding:24px;text-align:center;margin:0 0 24px">
        <p style="font-size:12px;font-weight:700;color:#6C3CE1;text-transform:uppercase;letter-spacing:2px;margin:0 0 12px">Ton code de vérification</p>
        <div style="font-size:42px;font-weight:900;color:#6C3CE1;letter-spacing:12px;font-variant-numeric:tabular-nums">${otp}</div>
      </div>
      <p style="font-size:13px;color:#7B7599;margin:0 0 4px">⚠️ Ne partage jamais ce code avec quelqu'un.</p>
      <p style="font-size:13px;color:#7B7599;margin:0">Si tu n'as pas créé de compte CinoX, ignore cet email.</p>
    </div>
    <!-- Footer -->
    <div style="background:#F4F3FF;padding:20px 32px;text-align:center;border-top:1px solid #E8E5F5">
      <p style="font-size:12px;color:#7B7599;margin:0">© 2025 CinoX – Madagascar 🇲🇬</p>
    </div>
  </div>
</body>
</html>`
    });
    console.log(`[EMAIL] OTP envoyé à ${toEmail}`, result.data?.id);
    return { sent: true, id: result.data?.id };
  } catch (err) {
    console.error(`[EMAIL] Erreur envoi à ${toEmail}:`, err.message);
    return { error: err.message };
  }
}

// ====== AUTH ======
app.post('/api/register', async (req, res) => {
  const { username, email, password, display_name, location } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Champs requis manquants' });
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Format d\'email invalide' });
  if (username.length < 3) return res.status(400).json({ error: 'Nom d\'utilisateur trop court (min. 3 caractères)' });
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) return res.status(400).json({ error: 'Nom d\'utilisateur invalide (lettres, chiffres, . _ - uniquement)' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (min. 6 caractères)' });
  try {
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users (username,email,password_hash,display_name,location,email_verified,otp_code,otp_expires_at)
       VALUES ($1,$2,$3,$4,$5,false,$6,$7) RETURNING id,username,email,display_name,location,avatar_url,bio`,
      [username.toLowerCase(), email.toLowerCase(), hash, display_name || username, location || 'Antananarivo', otp, otpExpires]
    );
    const emailResult = await sendOTPEmail(email.toLowerCase(), display_name || username, otp);
    const isDemo = !process.env.RESEND_API_KEY || emailResult.demo;
    res.json({
      pending_verification: true,
      user_id: r.rows[0].id,
      email: email.toLowerCase(),
      otp_demo: isDemo ? otp : undefined,
      email_sent: !isDemo
    });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nom d\'utilisateur ou email déjà utilisé' });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/verify-email', async (req, res) => {
  const { user_id, code } = req.body;
  if (!user_id || !code) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [user_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const user = r.rows[0];
    if (user.email_verified) return res.status(400).json({ error: 'Email déjà vérifié' });
    if (!user.otp_code) return res.status(400).json({ error: 'Aucun code en attente' });
    if (new Date() > new Date(user.otp_expires_at)) return res.status(400).json({ error: 'Code expiré. Demandez-en un nouveau.' });
    if (user.otp_code !== code.trim()) return res.status(400).json({ error: 'Code incorrect' });
    await pool.query('UPDATE users SET email_verified=true, otp_code=NULL, otp_expires_at=NULL WHERE id=$1', [user_id]);
    req.session.userId = user.id;
    const { password_hash, otp_code, otp_expires_at, ...safe } = user;
    res.json({ user: { ...safe, email_verified: true } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/resend-otp', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Données manquantes' });
  try {
    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 15 * 60 * 1000);
    const r = await pool.query('UPDATE users SET otp_code=$1, otp_expires_at=$2 WHERE id=$3 AND email_verified=false RETURNING email', [otp, otpExpires, user_id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable ou déjà vérifié' });
    const emailResult = await sendOTPEmail(r.rows[0].email, '', otp);
    const isDemo = !process.env.RESEND_API_KEY || emailResult.demo;
    res.json({ ok: true, otp_demo: isDemo ? otp : undefined, email_sent: !isDemo });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const r = await pool.query('SELECT * FROM users WHERE email=$1 OR username=$1', [email.toLowerCase()]);
    if (!r.rows.length) return res.status(401).json({ error: 'Utilisateur introuvable' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Mot de passe incorrect' });
    if (!user.email_verified) {
      return res.status(403).json({ error: 'email_not_verified', user_id: user.id, email: user.email });
    }
    req.session.userId = user.id;
    const { password_hash, otp_code, otp_expires_at, ...safe } = user;
    res.json({ user: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT u.*, 
      (SELECT COUNT(*) FROM follows WHERE following_id=u.id) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) as following_count,
      (SELECT COUNT(*) FROM products WHERE seller_id=u.id AND is_active=true) as products_count
     FROM users u WHERE u.id=$1`, [req.session.userId]);
  if (!r.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { password_hash, ...safe } = r.rows[0];
  res.json({ user: safe });
});

app.put('/api/me', auth, async (req, res) => {
  const { display_name, bio, location, phone_mvola, phone_orange, phone_airtel } = req.body;
  await pool.query(
    'UPDATE users SET display_name=$1,bio=$2,location=$3,phone_mvola=$4,phone_orange=$5,phone_airtel=$6 WHERE id=$7',
    [display_name, bio, location, phone_mvola, phone_orange, phone_airtel, req.session.userId]
  );
  res.json({ ok: true });
});

app.post('/api/me/avatar', auth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const url = '/uploads/' + req.file.filename;
  await pool.query('UPDATE users SET avatar_url=$1 WHERE id=$2', [url, req.session.userId]);
  res.json({ avatar_url: url });
});

// ====== USERS ======
app.get('/api/users/:id', async (req, res) => {
  const r = await pool.query(
    `SELECT u.id,u.username,u.display_name,u.bio,u.avatar_url,u.location,u.is_verified,u.sales_count,u.rating,u.created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id=u.id) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id=u.id) as following_count
     FROM users u WHERE u.id=$1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Introuvable' });
  res.json({ user: r.rows[0] });
});

// ====== PRODUCTS ======
app.get('/api/products', async (req, res) => {
  const { category, search, seller_id, limit = 20, offset = 0 } = req.query;
  let q = `SELECT p.*, u.display_name as seller_name, u.username as seller_username, u.avatar_url as seller_avatar, u.is_verified as seller_verified
           FROM products p JOIN users u ON p.seller_id=u.id WHERE p.is_active=true`;
  const params = [];
  if (category && category !== 'all') { params.push(category); q += ` AND p.category=$${params.length}`; }
  if (search) { params.push(`%${search}%`); q += ` AND (p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`; }
  if (seller_id) { params.push(seller_id); q += ` AND p.seller_id=$${params.length}`; }
  q += ` ORDER BY p.created_at DESC LIMIT $${params.length+1} OFFSET $${params.length+2}`;
  params.push(limit, offset);
  const r = await pool.query(q, params);
  res.json({ products: r.rows });
});

app.get('/api/products/:id', async (req, res) => {
  await pool.query('UPDATE products SET views=views+1 WHERE id=$1', [req.params.id]);
  const r = await pool.query(
    `SELECT p.*, u.display_name as seller_name, u.username as seller_username, u.avatar_url as seller_avatar,
            u.is_verified as seller_verified, u.sales_count, u.rating, u.phone_mvola, u.phone_orange, u.phone_airtel
     FROM products p JOIN users u ON p.seller_id=u.id WHERE p.id=$1`, [req.params.id]);
  if (!r.rows.length) return res.status(404).json({ error: 'Introuvable' });
  res.json({ product: r.rows[0] });
});

app.post('/api/products', auth, async (req, res) => {
  const { title, description, price, category, state, location, images } = req.body;
  const r = await pool.query(
    'INSERT INTO products (seller_id,title,description,price,category,state,location,images) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
    [req.session.userId, title, description, price, category, state, location, images || []]
  );
  res.json({ product: r.rows[0] });
});

app.post('/api/products/:id/image', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const url = '/uploads/' + req.file.filename;
  await pool.query('UPDATE products SET images=array_append(images,$1) WHERE id=$2 AND seller_id=$3', [url, req.params.id, req.session.userId]);
  res.json({ url });
});

app.delete('/api/products/:id', auth, async (req, res) => {
  await pool.query('UPDATE products SET is_active=false WHERE id=$1 AND seller_id=$2', [req.params.id, req.session.userId]);
  res.json({ ok: true });
});

// ====== LIKES ======
app.post('/api/products/:id/like', auth, async (req, res) => {
  const pid = req.params.id, uid = req.session.userId;
  const exists = await pool.query('SELECT 1 FROM likes WHERE user_id=$1 AND product_id=$2', [uid, pid]);
  if (exists.rows.length) {
    await pool.query('DELETE FROM likes WHERE user_id=$1 AND product_id=$2', [uid, pid]);
    await pool.query('UPDATE products SET likes_count=GREATEST(0,likes_count-1) WHERE id=$1', [pid]);
    res.json({ liked: false });
  } else {
    await pool.query('INSERT INTO likes (user_id,product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [uid, pid]);
    await pool.query('UPDATE products SET likes_count=likes_count+1 WHERE id=$1', [pid]);
    res.json({ liked: true });
  }
});

app.get('/api/me/likes', auth, async (req, res) => {
  const r = await pool.query('SELECT product_id FROM likes WHERE user_id=$1', [req.session.userId]);
  res.json({ liked: r.rows.map(r => r.product_id) });
});

// ====== FOLLOWS ======
app.post('/api/users/:id/follow', auth, async (req, res) => {
  const fing = req.params.id, fer = req.session.userId;
  if (fing == fer) return res.status(400).json({ error: 'Impossible de se suivre soi-même' });
  const exists = await pool.query('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [fer, fing]);
  if (exists.rows.length) {
    await pool.query('DELETE FROM follows WHERE follower_id=$1 AND following_id=$2', [fer, fing]);
    res.json({ following: false });
  } else {
    await pool.query('INSERT INTO follows (follower_id,following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [fer, fing]);
    await createNotification(fing, 'new_follower', { follower_id: fer });
    res.json({ following: true });
  }
});

app.get('/api/users/:id/following-status', auth, async (req, res) => {
  const r = await pool.query('SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2', [req.session.userId, req.params.id]);
  res.json({ following: r.rows.length > 0 });
});

// ====== CONVERSATIONS & MESSAGES ======
app.get('/api/conversations', auth, async (req, res) => {
  const uid = req.session.userId;
  const r = await pool.query(
    `SELECT c.*, 
      b.display_name as buyer_name, b.avatar_url as buyer_avatar,
      s.display_name as seller_name, s.avatar_url as seller_avatar,
      p.title as product_title, p.price as product_price, p.images[1] as product_img,
      (SELECT content FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE conversation_id=c.id ORDER BY created_at DESC LIMIT 1) as last_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id=c.id AND sender_id!=$1 AND created_at > COALESCE((SELECT last_read_at FROM conversation_reads WHERE conv_id=c.id AND user_id=$1), '2000-01-01')) as unread_count
     FROM conversations c
     JOIN users b ON c.buyer_id=b.id
     JOIN users s ON c.seller_id=s.id
     LEFT JOIN products p ON c.product_id=p.id
     WHERE c.buyer_id=$1 OR c.seller_id=$1
     ORDER BY last_at DESC NULLS LAST`, [uid]);
  res.json({ conversations: r.rows });
});

app.post('/api/conversations', auth, async (req, res) => {
  const { seller_id, product_id } = req.body;
  const uid = req.session.userId;
  if (uid == seller_id) return res.status(400).json({ error: 'Vous êtes le vendeur' });
  const r = await pool.query(
    `INSERT INTO conversations (buyer_id,seller_id,product_id) VALUES ($1,$2,$3)
     ON CONFLICT (buyer_id,seller_id,product_id) DO UPDATE SET buyer_id=EXCLUDED.buyer_id RETURNING *`,
    [uid, seller_id, product_id]
  );
  res.json({ conversation: r.rows[0] });
});

app.get('/api/conversations/:id/messages', auth, async (req, res) => {
  const uid = req.session.userId;
  const convCheck = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', [req.params.id, uid]);
  if (!convCheck.rows.length) return res.status(403).json({ error: 'Accès refusé' });
  const r = await pool.query(
    `SELECT m.*, u.display_name as sender_name, u.avatar_url as sender_avatar
     FROM messages m JOIN users u ON m.sender_id=u.id
     WHERE m.conversation_id=$1 ORDER BY m.created_at ASC`, [req.params.id]);
  res.json({ messages: r.rows });
});

app.post('/api/conversations/:id/messages', auth, async (req, res) => {
  const { content, type } = req.body;
  const uid = req.session.userId;
  const convCheck = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', [req.params.id, uid]);
  if (!convCheck.rows.length) return res.status(403).json({ error: 'Accès refusé' });
  const conv = convCheck.rows[0];
  const r = await pool.query(
    'INSERT INTO messages (conversation_id,sender_id,content,type) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, uid, content, type || 'text']
  );
  const msgRow = r.rows[0];
  const userRow = await pool.query('SELECT display_name,avatar_url FROM users WHERE id=$1', [uid]);
  const msg = { ...msgRow, sender_name: userRow.rows[0].display_name, sender_avatar: userRow.rows[0].avatar_url };
  const otherId = conv.buyer_id === uid ? conv.seller_id : conv.buyer_id;
  io.to(`user:${otherId}`).emit('new_message', { conversation_id: parseInt(req.params.id), message: msg });
  await createNotification(otherId, 'new_message', { conv_id: req.params.id, sender: userRow.rows[0].display_name, preview: content.slice(0,80) });
  res.json({ message: msg });
});

app.post('/api/conversations/:id/image', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier' });
  const uid = req.session.userId;
  const url = '/uploads/' + req.file.filename;
  const type = req.body.type || 'image';
  const convCheck = await pool.query('SELECT * FROM conversations WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', [req.params.id, uid]);
  if (!convCheck.rows.length) return res.status(403).json({ error: 'Accès refusé' });
  const conv = convCheck.rows[0];
  const r = await pool.query(
    'INSERT INTO messages (conversation_id,sender_id,content,image_url,type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.params.id, uid, type === 'payment_proof' ? 'Capture de paiement envoyée' : '', url, type]
  );
  const msgRow = r.rows[0];
  const userRow = await pool.query('SELECT display_name,avatar_url FROM users WHERE id=$1', [uid]);
  const msg = { ...msgRow, sender_name: userRow.rows[0].display_name, sender_avatar: userRow.rows[0].avatar_url };
  const otherId = conv.buyer_id === uid ? conv.seller_id : conv.buyer_id;
  io.to(`user:${otherId}`).emit('new_message', { conversation_id: parseInt(req.params.id), message: msg });
  if (type === 'payment_proof') {
    await createNotification(otherId, 'payment_received', { conv_id: req.params.id, sender: userRow.rows[0].display_name });
    io.to(`user:${otherId}`).emit('payment_proof', { conversation_id: parseInt(req.params.id) });
  }
  res.json({ message: msg });
});

app.post('/api/conversations/:id/confirm-payment', auth, async (req, res) => {
  const uid = req.session.userId;
  const convCheck = await pool.query('SELECT * FROM conversations WHERE id=$1 AND seller_id=$2', [req.params.id, uid]);
  if (!convCheck.rows.length) return res.status(403).json({ error: 'Seul le vendeur peut confirmer' });
  const conv = convCheck.rows[0];
  await pool.query('UPDATE conversations SET payment_status=$1 WHERE id=$2', ['confirmed', req.params.id]);
  await pool.query('UPDATE users SET sales_count=sales_count+1 WHERE id=$1', [uid]);
  const r = await pool.query(
    'INSERT INTO messages (conversation_id,sender_id,content,type) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.params.id, uid, '✅ Paiement confirmé par le vendeur !', 'system']
  );
  const userRow = await pool.query('SELECT display_name,avatar_url FROM users WHERE id=$1', [uid]);
  const msg = { ...r.rows[0], sender_name: userRow.rows[0].display_name, sender_avatar: userRow.rows[0].avatar_url };
  io.to(`user:${conv.buyer_id}`).emit('new_message', { conversation_id: parseInt(req.params.id), message: msg });
  io.to(`user:${conv.buyer_id}`).emit('payment_confirmed', { conversation_id: parseInt(req.params.id) });
  await createNotification(conv.buyer_id, 'payment_confirmed', { conv_id: req.params.id });
  res.json({ ok: true, message: msg });
});

// ====== NOTIFICATIONS ======
app.get('/api/notifications', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30', [req.session.userId]);
  res.json({ notifications: r.rows });
});

app.post('/api/notifications/read', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=true WHERE user_id=$1', [req.session.userId]);
  res.json({ ok: true });
});

// ====== FEED (following) ======
app.get('/api/feed', auth, async (req, res) => {
  const uid = req.session.userId;
  const r = await pool.query(
    `SELECT p.*, u.display_name as seller_name, u.username as seller_username, u.avatar_url as seller_avatar, u.is_verified as seller_verified
     FROM products p JOIN users u ON p.seller_id=u.id
     WHERE p.is_active=true AND (p.seller_id IN (SELECT following_id FROM follows WHERE follower_id=$1) OR p.seller_id=$1)
     ORDER BY p.created_at DESC LIMIT 20`, [uid]);
  res.json({ products: r.rows });
});

// ====== HELPERS ======
async function createNotification(userId, type, data) {
  try {
    const r = await pool.query('INSERT INTO notifications (user_id,type,data) VALUES ($1,$2,$3) RETURNING *', [userId, type, JSON.stringify(data)]);
    io.to(`user:${userId}`).emit('notification', r.rows[0]);
  } catch (e) { console.error('Notif error:', e.message); }
}

// ====== SOCKET.IO ======
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

io.on('connection', (socket) => {
  const uid = socket.request.session?.userId;
  if (uid) {
    socket.join(`user:${uid}`);
    console.log(`Socket connected: user ${uid}`);
  }
  socket.on('join_conversation', (convId) => socket.join(`conv:${convId}`));
  socket.on('leave_conversation', (convId) => socket.leave(`conv:${convId}`));
  socket.on('typing', ({ convId, name }) => socket.to(`conv:${convId}`).emit('typing', { name }));
  socket.on('stop_typing', ({ convId }) => socket.to(`conv:${convId}`).emit('stop_typing'));
  socket.on('disconnect', () => { if (uid) console.log(`Socket disconnected: user ${uid}`); });
});

// ====== START ======
initDB().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`CinoX running on port ${PORT}`));
});
