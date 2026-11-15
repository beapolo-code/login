require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const BetterSqlite3Store = require('better-sqlite3-session-store')(session);

const { sendLoginAlertEmail } = require('./emailService');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';
// Intentos fallidos permitidos antes de enviar la alerta de seguridad por email.
const FAILED_LOGIN_THRESHOLD = Number(process.env.MAX_FAILED_ATTEMPTS || 5);

app.disable('x-powered-by');
if (IS_PROD) app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
      },
    },
    // En desarrollo no forzamos HSTS (rompe http://localhost).
    strictTransportSecurity: IS_PROD ? undefined : false,
  })
);
app.use(express.json({ limit: '16kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.use(
  session({
    name: 'sid',
    secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-produccion',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: new BetterSqlite3Store({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: IS_PROD,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en 15 minutos.' },
});

// Las respuestas de la API nunca deben guardarse en cache (datos de sesion).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,79}$/u;
const PASSWORD_MAX_BYTES = 72; // limite de bcrypt

/**
 * Valida una cedula ecuatoriana (10 digitos, provincia, tercer digito y
 * digito verificador con algoritmo modulo 10).
 */
function isValidCedula(value) {
  if (!/^\d{10}$/.test(value)) return false;

  const province = Number(value.slice(0, 2));
  if (!((province >= 1 && province <= 24) || province === 30)) return false;
  if (Number(value[2]) >= 6) return false;

  const coefficients = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let total = 0;
  for (let i = 0; i < 9; i += 1) {
    let product = Number(value[i]) * coefficients[i];
    if (product > 9) product -= 9;
    total += product;
  }
  const checkDigit = (10 - (total % 10)) % 10;
  return checkDigit === Number(value[9]);
}

function validateRegistration({ fullName, cedula, email, password }) {
  const errors = {};

  if (!fullName || !NAME_RE.test(fullName)) {
    errors.fullName = 'Ingresa tu nombre completo (solo letras y espacios).';
  }
  if (!cedula) {
    errors.cedula = 'El numero de cedula es obligatorio.';
  } else if (!/^\d{10}$/.test(cedula)) {
    errors.cedula = 'La cedula debe tener exactamente 10 digitos.';
  } else if (!isValidCedula(cedula)) {
    errors.cedula = 'El numero de cedula no es valido.';
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    errors.email = 'Ingresa un email valido.';
  }
  if (!password || password.length < 8) {
    errors.password = 'La contrasena debe tener al menos 8 caracteres.';
  } else if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    errors.password = 'La contrasena es demasiado larga (maximo 72 bytes).';
  }

  return errors;
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.status(401).json({ error: 'No autenticado.' });
}

// Control de intentos fallidos de login (para alertas de seguridad).
function registerFailedLoginAttempt(key) {
  const row = db.prepare('SELECT attempts FROM failed_attempts WHERE key = ?').get(key);
  const attempts = (row ? Number(row.attempts) : 0) + 1;
  if (row) {
    db.prepare(
      'UPDATE failed_attempts SET attempts = ?, updated_at = datetime(\'now\') WHERE key = ?'
    ).run(attempts, key);
  } else {
    db.prepare(
      'INSERT INTO failed_attempts (key, attempts, updated_at) VALUES (?, ?, datetime(\'now\'))'
    ).run(key, attempts);
  }
  return attempts;
}

function resetFailedLoginAttempts(key) {
  db.prepare('DELETE FROM failed_attempts WHERE key = ?').run(key);
}

app.post('/api/register', authLimiter, async (req, res, next) => {
  try {
    const fullName = String(req.body.fullName || req.body.full_name || '').trim();
    const cedula = String(req.body.cedula || req.body.username || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const errors = validateRegistration({ fullName, cedula, email, password });
    if (Object.keys(errors).length) {
      return res.status(400).json({ error: 'Revisa los datos ingresados.', fields: errors });
    }

    const exists = db
      .prepare(
        'SELECT id FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)'
      )
      .get(cedula, email);
    if (exists) {
      return res.status(409).json({ error: 'La cedula o el email ya estan registrados.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const info = db
      .prepare(
        'INSERT INTO users (username, email, password_hash, full_name) VALUES (?, ?, ?, ?)'
      )
      .run(cedula, email, passwordHash, fullName);

    req.session.userId = info.lastInsertRowid;
    req.session.username = fullName;
    return res.status(201).json({
      message: 'Cuenta creada.',
      user: { username: cedula, fullName, email },
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/login', authLimiter, async (req, res, next) => {
  try {
    const identifier = String(
      req.body.cedula || req.body.identifier || req.body.username || req.body.email || ''
    ).trim();
    const password = String(req.body.password || '');

    if (!identifier || !password) {
      return res
        .status(400)
        .json({ error: 'El numero de cedula y la contrasena son obligatorios.' });
    }

    const user = db
      .prepare(
        'SELECT id, username, email, full_name, password_hash FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)'
      )
      .get(identifier, identifier);

    if (!user) {
      // Comparacion falsa para mantener un tiempo de respuesta similar.
      await bcrypt.compare(password, '$2a$12$0000000000000000000000000000000000000000000000000000');
      const message = /^\d{10}$/.test(identifier)
        ? 'Cedula no registrada.'
        : 'Usuario o contrasena incorrectos.';
      return res.status(401).json({ error: message });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const message = /^\d{10}$/.test(identifier)
        ? 'Contrasena incorrecta.'
        : 'Usuario o contrasena incorrectos.';

      // Registra el intento fallido y envia la alerta de seguridad
      // al email registrado cuando se supera el umbral de intentos.
      const userKey = `user:${user.id}`;
      const attempts = registerFailedLoginAttempt(userKey);
      if (attempts >= FAILED_LOGIN_THRESHOLD) {
        sendLoginAlertEmail({
          to: user.email,
          fullName: user.full_name || user.username,
          cedula: user.username,
        }).catch(() => {});
      }

      return res.status(401).json({ error: message });
    }

    resetFailedLoginAttempts(`user:${user.id}`);

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        return res.json({ message: 'Sesion iniciada.', user: { username: user.username } });
      });
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'No se pudo cerrar la sesion.' });
    res.clearCookie('sid', { httpOnly: true, sameSite: 'lax', secure: IS_PROD });
    return res.json({ message: 'Sesion cerrada.' });
  });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, username, email, full_name, created_at FROM users WHERE id = ?')
    .get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });

  res.json({
    user: {
      id: user.id,
      cedula: user.username,
      email: user.email,
      fullName: user.full_name || user.username,
      createdAt: user.created_at,
    },
  });
});

function pageGuard(req, res, next) {
  if (req.session && req.session.userId) return next();
  return res.redirect('/login.html');
}

function guestOnly(req, res, next) {
  if (req.session && req.session.userId) return res.redirect('/dashboard.html');
  return next();
}

app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/login.html', guestOnly, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login.html'))
);
app.get('/register.html', guestOnly, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'register.html'))
);
app.get('/dashboard.html', pageGuard, (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
);

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Ruta no encontrada.' });
  }
  return res.status(404).send('Pagina no encontrada.');
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
});
