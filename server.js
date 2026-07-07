const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'rm_streaming_secret_32chars_minimum!!',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

// Init DB
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cuentas_completas (
      id SERIAL PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255),
      contrasena VARCHAR(255), plataforma VARCHAR(100), fecha_compra DATE,
      fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1,
      whatsapp VARCHAR(50), proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cuentas_madre (
      id SERIAL PRIMARY KEY, plataforma VARCHAR(100), correo VARCHAR(255),
      contrasena VARCHAR(255), proveedor VARCHAR(255), num_perfiles INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS perfiles (
      id SERIAL PRIMARY KEY, cuenta_madre_id INTEGER REFERENCES cuentas_madre(id) ON DELETE CASCADE,
      nombre_cliente VARCHAR(255), telefono VARCHAR(50), correo VARCHAR(255),
      fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1, precio DECIMAL(10,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS musica (
      id SERIAL PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255),
      contrasena VARCHAR(255), telefono VARCHAR(50), tipo_producto VARCHAR(255),
      fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1,
      proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tv_digital (
      id SERIAL PRIMARY KEY, nombre VARCHAR(255), usuario VARCHAR(255),
      contrasena VARCHAR(255), telefono VARCHAR(50), plataforma VARCHAR(100),
      fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1,
      proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW()
    );
  `);
}

// Auth middleware
function auth(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.status(401).json({ error: 'No autorizado' });
}

// ─── AUTH ───────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const u = process.env.APP_USER || 'rmstreaming';
  const p = process.env.APP_PASSWORD || 'toreto28';
  if (username === u && password === p) {
    req.session.loggedIn = true;
    req.session.username = username;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.loggedIn) res.json({ loggedIn: true, username: req.session.username });
  else res.json({ loggedIn: false });
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const last  = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
    const [cc, pe, mu, tv, ccm, pem, mum, tvm] = await Promise.all([
      pool.query(`SELECT COUNT(*) c, COALESCE(SUM(precio),0) t FROM cuentas_completas`),
      pool.query(`SELECT COUNT(*) c, COALESCE(SUM(precio),0) t FROM perfiles`),
      pool.query(`SELECT COUNT(*) c, COALESCE(SUM(precio),0) t FROM musica`),
      pool.query(`SELECT COUNT(*) c, COALESCE(SUM(precio),0) t FROM tv_digital`),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM cuentas_completas WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM perfiles WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM musica WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM tv_digital WHERE created_at BETWEEN $1 AND $2`,[first,last]),
    ]);
    const cats = [
      { nombre:'Cuenta Completa', count: parseInt(cc.rows[0].c) },
      { nombre:'Perfiles',        count: parseInt(pe.rows[0].c) },
      { nombre:'Música',          count: parseInt(mu.rows[0].c) },
      { nombre:'TV Digital',      count: parseInt(tv.rows[0].c) },
    ];
    res.json({
      ganancia_mes: [ccm,pem,mum,tvm].reduce((a,r)=>a+parseFloat(r.rows[0].t),0),
      ganancia_acumulada: [cc,pe,mu,tv].reduce((a,r)=>a+parseFloat(r.rows[0].t),0),
      total_registros: cats.reduce((a,c)=>a+c.count,0),
      categorias: cats,
      mas_vendido: cats.reduce((a,b)=>a.count>b.count?a:b).nombre,
    });
  } catch(e){ res.status(500).json({error:String(e)}); }
});

// ─── CUENTAS COMPLETAS ───────────────────────────────────────────────────────
app.get('/api/cuentas/completas', auth, async (req,res) => {
  const q = req.query.q || '';
  try {
    const r = await pool.query(
      `SELECT * FROM cuentas_completas WHERE nombre ILIKE $1 OR correo ILIKE $1 OR whatsapp ILIKE $1 ORDER BY fecha_vencimiento ASC`,
      [`%${q}%`]);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.post('/api/cuentas/completas', auth, async (req,res) => {
  const {nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `INSERT INTO cuentas_completas (nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [nombre,correo,contrasena,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,whatsapp,proveedor,precio||0]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.put('/api/cuentas/completas/:id', auth, async (req,res) => {
  const {nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `UPDATE cuentas_completas SET nombre=$1,correo=$2,contrasena=$3,plataforma=$4,fecha_compra=$5,fecha_vencimiento=$6,meses_vendidos=$7,whatsapp=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,
      [nombre,correo,contrasena,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,whatsapp,proveedor,precio||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.delete('/api/cuentas/completas/:id', auth, async (req,res) => {
  try { await pool.query(`DELETE FROM cuentas_completas WHERE id=$1`,[req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});

// ─── CUENTAS MADRE + PERFILES ─────────────────────────────────────────────────
app.get('/api/cuentas/madre', auth, async (req,res) => {
  try {
    const madres = await pool.query(`SELECT * FROM cuentas_madre ORDER BY created_at DESC`);
    const result = [];
    for (const m of madres.rows) {
      const p = await pool.query(`SELECT * FROM perfiles WHERE cuenta_madre_id=$1 ORDER BY id ASC`,[m.id]);
      result.push({...m, perfiles: p.rows});
    }
    res.json(result);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.post('/api/cuentas/madre', auth, async (req,res) => {
  const {plataforma,correo,contrasena,proveedor,num_perfiles,perfiles}=req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const m = await client.query(
      `INSERT INTO cuentas_madre (plataforma,correo,contrasena,proveedor,num_perfiles) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [plataforma,correo,contrasena,proveedor,num_perfiles||1]);
    const mid = m.rows[0].id;
    if (perfiles && perfiles.length) {
      for (const p of perfiles)
        await client.query(`INSERT INTO perfiles (cuenta_madre_id,nombre_cliente,telefono,correo,fecha_vencimiento,meses_vendidos,precio) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [mid,p.nombre_cliente,p.telefono,p.correo,p.fecha_vencimiento||null,p.meses_vendidos||1,p.precio||0]);
    }
    await client.query('COMMIT');
    res.json(m.rows[0]);
  } catch(e){ await client.query('ROLLBACK'); res.status(500).json({error:String(e)}); }
  finally { client.release(); }
});
app.put('/api/cuentas/madre/:id', auth, async (req,res) => {
  const {plataforma,correo,contrasena,proveedor,num_perfiles}=req.body;
  try {
    const r = await pool.query(
      `UPDATE cuentas_madre SET plataforma=$1,correo=$2,contrasena=$3,proveedor=$4,num_perfiles=$5 WHERE id=$6 RETURNING *`,
      [plataforma,correo,contrasena,proveedor,num_perfiles,req.params.id]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.delete('/api/cuentas/madre/:id', auth, async (req,res) => {
  try { await pool.query(`DELETE FROM cuentas_madre WHERE id=$1`,[req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});
app.put('/api/cuentas/perfiles/:id', auth, async (req,res) => {
  const {nombre_cliente,telefono,correo,fecha_vencimiento,meses_vendidos,precio}=req.body;
  try {
    const r = await pool.query(
      `UPDATE perfiles SET nombre_cliente=$1,telefono=$2,correo=$3,fecha_vencimiento=$4,meses_vendidos=$5,precio=$6 WHERE id=$7 RETURNING *`,
      [nombre_cliente,telefono,correo,fecha_vencimiento||null,meses_vendidos||1,precio||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.delete('/api/cuentas/perfiles/:id', auth, async (req,res) => {
  try { await pool.query(`DELETE FROM perfiles WHERE id=$1`,[req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});

// ─── MÚSICA ──────────────────────────────────────────────────────────────────
app.get('/api/musica', auth, async (req,res) => {
  const q = req.query.q||'';
  try {
    const r = await pool.query(`SELECT * FROM musica WHERE nombre ILIKE $1 OR correo ILIKE $1 OR telefono ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.post('/api/musica', auth, async (req,res) => {
  const {nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `INSERT INTO musica (nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [nombre,correo,contrasena,telefono,tipo_producto,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.put('/api/musica/:id', auth, async (req,res) => {
  const {nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `UPDATE musica SET nombre=$1,correo=$2,contrasena=$3,telefono=$4,tipo_producto=$5,fecha_compra=$6,fecha_vencimiento=$7,meses_vendidos=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,
      [nombre,correo,contrasena,telefono,tipo_producto,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.delete('/api/musica/:id', auth, async (req,res) => {
  try { await pool.query(`DELETE FROM musica WHERE id=$1`,[req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});

// ─── TV DIGITAL ───────────────────────────────────────────────────────────────
app.get('/api/tv-digital', auth, async (req,res) => {
  const q = req.query.q||'';
  try {
    const r = await pool.query(`SELECT * FROM tv_digital WHERE nombre ILIKE $1 OR usuario ILIKE $1 OR telefono ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]);
    res.json(r.rows);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.post('/api/tv-digital', auth, async (req,res) => {
  const {nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `INSERT INTO tv_digital (nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [nombre,usuario,contrasena,telefono,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.put('/api/tv-digital/:id', auth, async (req,res) => {
  const {nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body;
  try {
    const r = await pool.query(
      `UPDATE tv_digital SET nombre=$1,usuario=$2,contrasena=$3,telefono=$4,plataforma=$5,fecha_compra=$6,fecha_vencimiento=$7,meses_vendidos=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,
      [nombre,usuario,contrasena,telefono,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0,req.params.id]);
    res.json(r.rows[0]);
  } catch(e){ res.status(500).json({error:String(e)}); }
});
app.delete('/api/tv-digital/:id', auth, async (req,res) => {
  try { await pool.query(`DELETE FROM tv_digital WHERE id=$1`,[req.params.id]); res.json({success:true}); }
  catch(e){ res.status(500).json({error:String(e)}); }
});

// ─── SPA CATCH-ALL ────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`RM Streaming server on port ${PORT}`);
  try { await initDB(); console.log('DB initialized'); }
  catch(e){ console.error('DB init error:', e.message); }
});
