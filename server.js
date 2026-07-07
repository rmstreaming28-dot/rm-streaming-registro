const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: process.env.SESSION_SECRET || 'rm_streaming_secret_32chars_min!!', resave: false, saveUninitialized: false, cookie: { secure: false, httpOnly: true, maxAge: 7*24*60*60*1000 } }));

async function initDB() {
  await pool.query(`ALTER TABLE IF EXISTS perfiles ADD COLUMN IF NOT EXISTS plataforma VARCHAR(100)`).catch(()=>{});
  await pool.query(`ALTER TABLE IF EXISTS perfiles ADD COLUMN IF NOT EXISTS nombre_perfil VARCHAR(255)`).catch(()=>{});
  await pool.query(`ALTER TABLE IF EXISTS perfiles ADD COLUMN IF NOT EXISTS proveedor VARCHAR(255)`).catch(()=>{});
  await pool.query(`ALTER TABLE IF EXISTS perfiles ADD COLUMN IF NOT EXISTS fecha_compra DATE`).catch(()=>{});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cuentas_completas (id SERIAL PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255), contrasena VARCHAR(255), plataforma VARCHAR(100), fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1, whatsapp VARCHAR(50), proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS perfiles (id SERIAL PRIMARY KEY, nombre_cliente VARCHAR(255), telefono VARCHAR(50), correo VARCHAR(255), plataforma VARCHAR(100), fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1, precio DECIMAL(10,2) DEFAULT 0, proveedor VARCHAR(255), created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS musica (id SERIAL PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255), contrasena VARCHAR(255), telefono VARCHAR(50), tipo_producto VARCHAR(255), fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1, proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS tv_digital (id SERIAL PRIMARY KEY, nombre VARCHAR(255), usuario VARCHAR(255), contrasena VARCHAR(255), telefono VARCHAR(50), plataforma VARCHAR(100), fecha_compra DATE, fecha_vencimiento DATE, meses_vendidos INTEGER DEFAULT 1, proveedor VARCHAR(255), precio DECIMAL(10,2) DEFAULT 0, created_at TIMESTAMP DEFAULT NOW());
  `);
}

function auth(req,res,next){ if(req.session&&req.session.loggedIn) return next(); res.status(401).json({error:'No autorizado'}); }

app.post('/api/login',(req,res)=>{ const {username,password}=req.body; if(username===(process.env.APP_USER||'rmstreaming')&&password===(process.env.APP_PASSWORD||'toreto28')){ req.session.loggedIn=true; req.session.username=username; res.json({success:true}); } else res.status(401).json({error:'Usuario o contraseña incorrectos'}); });
app.post('/api/logout',(req,res)=>{ req.session.destroy(); res.json({success:true}); });
app.get('/api/me',(req,res)=>{ res.json(req.session&&req.session.loggedIn?{loggedIn:true,username:req.session.username}:{loggedIn:false}); });

app.get('/api/dashboard', auth, async (req,res)=>{
  try {
    const now=new Date(), first=new Date(now.getFullYear(),now.getMonth(),1).toISOString().split('T')[0], last=new Date(now.getFullYear(),now.getMonth()+1,0).toISOString().split('T')[0];
    const [cc,pe,mu,tv,ccm,pem,mum,tvm]=await Promise.all([
      pool.query(`SELECT COUNT(*) c,COALESCE(SUM(precio),0) t FROM cuentas_completas`),
      pool.query(`SELECT COUNT(*) c,COALESCE(SUM(precio),0) t FROM perfiles`),
      pool.query(`SELECT COUNT(*) c,COALESCE(SUM(precio),0) t FROM musica`),
      pool.query(`SELECT COUNT(*) c,COALESCE(SUM(precio),0) t FROM tv_digital`),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM cuentas_completas WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM perfiles WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM musica WHERE created_at BETWEEN $1 AND $2`,[first,last]),
      pool.query(`SELECT COALESCE(SUM(precio),0) t FROM tv_digital WHERE created_at BETWEEN $1 AND $2`,[first,last]),
    ]);
    const cats=[{nombre:'Cuenta Completa',count:parseInt(cc.rows[0].c)},{nombre:'Perfiles',count:parseInt(pe.rows[0].c)},{nombre:'Música',count:parseInt(mu.rows[0].c)},{nombre:'TV Digital',count:parseInt(tv.rows[0].c)}];
    res.json({ganancia_mes:[ccm,pem,mum,tvm].reduce((a,r)=>a+parseFloat(r.rows[0].t),0),ganancia_acumulada:[cc,pe,mu,tv].reduce((a,r)=>a+parseFloat(r.rows[0].t),0),total_registros:cats.reduce((a,c)=>a+c.count,0),categorias:cats,mas_vendido:cats.reduce((a,b)=>a.count>b.count?a:b).nombre});
  } catch(e){ res.status(500).json({error:String(e)}); }
});

// CUENTAS COMPLETAS
app.get('/api/cuentas/completas',auth,async(req,res)=>{ const q=req.query.q||''; try{ const r=await pool.query(`SELECT * FROM cuentas_completas WHERE nombre ILIKE $1 OR correo ILIKE $1 OR whatsapp ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]); res.json(r.rows); }catch(e){ res.status(500).json({error:String(e)}); }});
app.post('/api/cuentas/completas',auth,async(req,res)=>{ const {nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio}=req.body; try{ const r=await pool.query(`INSERT INTO cuentas_completas (nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[nombre,correo,contrasena,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,whatsapp,proveedor,precio||0]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.put('/api/cuentas/completas/:id',auth,async(req,res)=>{ const {nombre,correo,contrasena,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,whatsapp,proveedor,precio}=req.body; try{ const r=await pool.query(`UPDATE cuentas_completas SET nombre=$1,correo=$2,contrasena=$3,plataforma=$4,fecha_compra=$5,fecha_vencimiento=$6,meses_vendidos=$7,whatsapp=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,[nombre,correo,contrasena,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,whatsapp,proveedor,precio||0,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.delete('/api/cuentas/completas/:id',auth,async(req,res)=>{ try{ await pool.query(`DELETE FROM cuentas_completas WHERE id=$1`,[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:String(e)}); }});
app.patch('/api/cuentas/completas/:id',auth,async(req,res)=>{ try{ const r=await pool.query(`UPDATE cuentas_completas SET fecha_vencimiento=$1 WHERE id=$2 RETURNING *`,[req.body.fecha_vencimiento,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});

// PERFILES (flat)
app.get('/api/perfiles',auth,async(req,res)=>{ const q=req.query.q||''; try{ const r=await pool.query(`SELECT * FROM perfiles WHERE nombre_cliente ILIKE $1 OR telefono ILIKE $1 OR correo ILIKE $1 OR nombre_perfil ILIKE $1 OR plataforma ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]); res.json(r.rows); }catch(e){ res.status(500).json({error:String(e)}); }});
app.post('/api/perfiles',auth,async(req,res)=>{ const {nombre_perfil,nombre_cliente,telefono,plataforma,proveedor,fecha_compra,fecha_vencimiento,meses_vendidos,precio}=req.body; try{ const r=await pool.query(`INSERT INTO perfiles (nombre_perfil,nombre_cliente,telefono,plataforma,proveedor,fecha_compra,fecha_vencimiento,meses_vendidos,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[nombre_perfil,nombre_cliente,telefono,plataforma,proveedor||null,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,precio||0]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.put('/api/perfiles/:id',auth,async(req,res)=>{ const {nombre_perfil,nombre_cliente,telefono,plataforma,proveedor,fecha_compra,fecha_vencimiento,meses_vendidos,precio}=req.body; try{ const r=await pool.query(`UPDATE perfiles SET nombre_perfil=$1,nombre_cliente=$2,telefono=$3,plataforma=$4,proveedor=$5,fecha_compra=$6,fecha_vencimiento=$7,meses_vendidos=$8,precio=$9 WHERE id=$10 RETURNING *`,[nombre_perfil,nombre_cliente,telefono,plataforma,proveedor||null,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,precio||0,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.delete('/api/perfiles/:id',auth,async(req,res)=>{ try{ await pool.query(`DELETE FROM perfiles WHERE id=$1`,[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:String(e)}); }});
app.patch('/api/perfiles/:id',auth,async(req,res)=>{ try{ const r=await pool.query(`UPDATE perfiles SET fecha_vencimiento=$1 WHERE id=$2 RETURNING *`,[req.body.fecha_vencimiento,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});

// MÚSICA
app.get('/api/musica',auth,async(req,res)=>{ const q=req.query.q||''; try{ const r=await pool.query(`SELECT * FROM musica WHERE nombre ILIKE $1 OR correo ILIKE $1 OR telefono ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]); res.json(r.rows); }catch(e){ res.status(500).json({error:String(e)}); }});
app.post('/api/musica',auth,async(req,res)=>{ const {nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body; try{ const r=await pool.query(`INSERT INTO musica (nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[nombre,correo,contrasena,telefono,tipo_producto,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.put('/api/musica/:id',auth,async(req,res)=>{ const {nombre,correo,contrasena,telefono,tipo_producto,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body; try{ const r=await pool.query(`UPDATE musica SET nombre=$1,correo=$2,contrasena=$3,telefono=$4,tipo_producto=$5,fecha_compra=$6,fecha_vencimiento=$7,meses_vendidos=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,[nombre,correo,contrasena,telefono,tipo_producto,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.delete('/api/musica/:id',auth,async(req,res)=>{ try{ await pool.query(`DELETE FROM musica WHERE id=$1`,[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:String(e)}); }});
app.patch('/api/musica/:id',auth,async(req,res)=>{ try{ const r=await pool.query(`UPDATE musica SET fecha_vencimiento=$1 WHERE id=$2 RETURNING *`,[req.body.fecha_vencimiento,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});

// TV DIGITAL
app.get('/api/tv-digital',auth,async(req,res)=>{ const q=req.query.q||''; try{ const r=await pool.query(`SELECT * FROM tv_digital WHERE nombre ILIKE $1 OR usuario ILIKE $1 OR telefono ILIKE $1 ORDER BY fecha_vencimiento ASC`,[`%${q}%`]); res.json(r.rows); }catch(e){ res.status(500).json({error:String(e)}); }});
app.post('/api/tv-digital',auth,async(req,res)=>{ const {nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body; try{ const r=await pool.query(`INSERT INTO tv_digital (nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[nombre,usuario,contrasena,telefono,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.put('/api/tv-digital/:id',auth,async(req,res)=>{ const {nombre,usuario,contrasena,telefono,plataforma,fecha_compra,fecha_vencimiento,meses_vendidos,proveedor,precio}=req.body; try{ const r=await pool.query(`UPDATE tv_digital SET nombre=$1,usuario=$2,contrasena=$3,telefono=$4,plataforma=$5,fecha_compra=$6,fecha_vencimiento=$7,meses_vendidos=$8,proveedor=$9,precio=$10 WHERE id=$11 RETURNING *`,[nombre,usuario,contrasena,telefono,plataforma,fecha_compra||null,fecha_vencimiento||null,meses_vendidos||1,proveedor,precio||0,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});
app.delete('/api/tv-digital/:id',auth,async(req,res)=>{ try{ await pool.query(`DELETE FROM tv_digital WHERE id=$1`,[req.params.id]); res.json({success:true}); }catch(e){ res.status(500).json({error:String(e)}); }});
app.patch('/api/tv-digital/:id',auth,async(req,res)=>{ try{ const r=await pool.query(`UPDATE tv_digital SET fecha_vencimiento=$1 WHERE id=$2 RETURNING *`,[req.body.fecha_vencimiento,req.params.id]); res.json(r.rows[0]); }catch(e){ res.status(500).json({error:String(e)}); }});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));



// ── KEEP-ALIVE: auto-ping cada 10 min para evitar que el server se duerma ──
app.get('/api/ping', (req,res)=>res.json({ok:true,ts:Date.now()}));
app.listen(PORT, async()=>{
  console.log('RM Streaming port',PORT);
  try{ await initDB(); console.log('DB OK'); }catch(e){ console.error('DB err',e.message); }
  const https=require('https'),http=require('http');
  const SELF=process.env.APP_URL||'https://rm-streaming-registro.onrender.com';
  if(SELF){
    setInterval(()=>{
      const mod=SELF.startsWith('https')?https:http;
      mod.get(SELF+'/api/ping',(r)=>r.resume()).on('error',()=>{});
      console.log('keep-alive ping ->',SELF+'/api/ping');
    }, 10*60*1000);
    console.log('keep-alive activo ->',SELF);
  } else {
    console.log('keep-alive: define APP_URL en env para activar ping externo');
  }
});
