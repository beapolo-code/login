# login-app

Aplicación de login 100% funcional con Node.js + Express, SQLite, contraseñas hasheadas (bcrypt), sesiones con cookie y rutas protegidas. La interfaz replica el diseño de Figma y está en español.

## Requisitos

- Node.js 22 o superior (probado con Node 24)
- npm

## Cómo correrla

```powershell
npm install
npm start
```

Abre http://localhost:3000

El archivo `.env` ya se creó a partir de `.env.example`. En producción cambia `SESSION_SECRET` por un valor largo y aleatorio.

> **Nota sobre `better-sqlite3`:** se usa la versión 13.x porque las versiones 11.x fallaban al cerrar el proceso con Node 24 (`Assertion failed: (env) != nullptr`).

## Uso

1. Entra a **Regístrate** y crea una cuenta con:
   - Nombre completo
   - **Número de cédula** (10 dígitos, cédula ecuatoriana válida)
   - Email
   - Contraseña de mínimo 8 caracteres
2. Al registrarte se inicia la sesión y te redirige al panel **Mi cuenta**.
3. Cierra sesión y vuelve a entrar con tu cédula y contraseña.

Cédula de ejemplo válida para pruebas: `1712345675`.

El login acepta la cédula (también el email o el nombre de usuario antiguo, para compatibilidad).

## Estructura

```
login-app/
  server.js              API, validaciones y servidor Express
  db.js                  Conexión SQLite (crea data/app.db) y migraciones
  emailService.js        Envío de alertas de seguridad por email (SMTP/Gmail)
  public/
    login.html           Formulario de inicio de sesión
    register.html        Formulario de registro
    dashboard.html       Página protegida (solo con sesión)
    css/styles.css       Estilos (diseño de Figma)
    js/auth.js           Lógica del cliente
    favicon.svg          Icono de la app
  .env / .env.example    Variables de entorno
  data/app.db            Base de datos (se genera sola)
```

## Endpoints

| Método | Ruta            | Descripción                                      |
|--------|-----------------|--------------------------------------------------|
| POST   | `/api/register` | Crea la cuenta e inicia sesión                   |
| POST   | `/api/login`    | Inicia sesión con cédula (o email/usuario)       |
| POST   | `/api/logout`   | Cierra la sesión                                 |
| GET    | `/api/me`       | Datos del usuario autenticado                    |

Páginas: `/login.html`, `/register.html` y `/dashboard.html` (protegida). `/` redirige a login.

### Ejemplo con curl

```powershell
curl -c cookies.txt -H "Content-Type: application/json" `
  -d '{"fullName":"Ana María López","cedula":"1712345675","email":"ana@demo.com","password":"Password123"}' `
  http://localhost:3000/api/register

curl -b cookies.txt http://localhost:3000/api/me
```

## Validaciones

- **Cédula ecuatoriana:** exactamente 10 dígitos, provincia válida (01–24 o 30), tercer dígito menor a 6 y dígito verificador con algoritmo módulo 10. Se valida en cliente y servidor.
- **Nombre completo:** solo letras, espacios, apóstrofes, puntos y guiones (máx. 80).
- **Email:** formato válido y máximo 254 caracteres.
- **Contraseña:** mínimo 8 caracteres y máximo 72 bytes (límite de bcrypt).

## Seguridad incluida

- Contraseñas con hash bcrypt (12 rondas), nunca en texto plano.
- Sesiones guardadas en SQLite con cookie `httpOnly` y `sameSite=lax`.
- Regeneración del ID de sesión al iniciar sesión (evita session fixation).
- Validación de todos los campos en el servidor (no se confía solo en el cliente).
- Rate limiting en login/registro (20 intentos por 15 min).
- Cabeceras de seguridad con Helmet y CSP que permite solo Google Fonts.
- Respuestas de `/api` con `Cache-Control: no-store`.
- Índices únicos sin distinguir mayúsculas/minúsculas para cédula/email.

## Alerta de seguridad por correo (Gmail)

Cuando un usuario registra intentos fallidos de inicio de sesión, el sistema los acumula por cuenta. Al llegar al umbral configurado (`MAX_FAILED_ATTEMPTS`, por defecto **5** intentos fallidos), se envía un correo de alerta automático al **email registrado** en la cuenta, recomendándole cambiar la contraseña.

### Configurar el envío por Gmail SMTP

1. Entra en tu cuenta de Google y activa la verificación en dos pasos (**2FA**).
2. Crea una **Contraseña de aplicación** para Gmail:
   - Ve a <https://myaccount.google.com/apppasswords>.
   - Selecciona "Correo" como aplicación y "Dispositivo" (ej. "Node.js").
   - Genera y copia la contraseña de 16 caracteres.
3. En el archivo `.env` de la app, configura:

   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_USER=tu.email@gmail.com
   SMTP_PASS=tu.contrasena_de_aplicacion_de_gmail
   SMTP_FROM=tu.email@gmail.com
   MAX_FAILED_ATTEMPTS=5
   ```

4. Reinicia el servidor.

> **Nota:** si no configuras `SMTP_USER` y `SMTP_PASS`, la app arranca sin el envío de correos (solo registra el intento en consola).

## Variables de entorno

| Variable         | Por defecto        | Descripción                                      |
|------------------|--------------------|--------------------------------------------------|
| `PORT`           | `3000`             | Puerto del servidor                              |
| `NODE_ENV`       | `development`      | `development` o `production`                     |
| `SESSION_SECRET` | (valor de ejemplo)| Secreto para firmar la cookie de sesión          |
| `DB_PATH`        | `data/app.db`      | Ruta opcional de la base de datos SQLite         |
| `MAX_FAILED_ATTEMPTS` | `5`          | Intentos fallidos antes de enviar la alerta     |
| `SMTP_HOST`      | `smtp.gmail.com`   | Servidor SMTP para las alertas                  |
| `SMTP_PORT`      | `465`              | Puerto SMTP                                      |
| `SMTP_USER`      | —                  | Email de Gmail remitente (con contraseña app.)  |
| `SMTP_PASS`      | —                  | Contraseña de aplicación de Gmail               |
| `SMTP_FROM`      | `SMTP_USER`        | Remitente del correo de alerta                  |
