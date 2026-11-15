(function () {
  'use strict';

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const NAME_RE = /^[\p{L}][\p{L}\s'.-]{1,79}$/u;

  const message = document.getElementById('message');
  const messageText = document.getElementById('message-text');

  function hideAlert() {
    if (!message) return;
    message.classList.remove('is-visible', 'is-success');
    message.setAttribute('aria-hidden', 'true');
    if (messageText) messageText.textContent = '';
  }

  function showAlert(text, type) {
    if (!message || !messageText) return;
    messageText.textContent = text;
    message.classList.toggle('is-success', type === 'success');
    message.classList.add('is-visible');
    message.setAttribute('aria-hidden', 'false');
  }

  function markInvalid(input, invalid) {
    if (!input) return;
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }

  function clearFormErrors(form) {
    form.querySelectorAll('[aria-invalid="true"]').forEach((el) => markInvalid(el, false));
  }

  function setLoading(button, loading) {
    if (!button) return;
    button.disabled = loading;
    button.classList.toggle('is-loading', loading);
    button.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  async function api(url, options) {
    let res;
    try {
      res = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
    } catch (_) {
      throw new Error('No se pudo conectar con el servidor. Revisa tu conexión.');
    }

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      /* respuesta sin JSON */
    }

    if (!res.ok) {
      const error = new Error(data.error || 'Ocurrió un error inesperado.');
      error.status = res.status;
      error.fields = data.fields || null;
      throw error;
    }
    return data;
  }

  // ---------------------------------------------------------------------
  // Utilidades de validación (duplican las reglas del servidor)
  // ---------------------------------------------------------------------

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
    return (10 - (total % 10)) % 10 === Number(value[9]);
  }

  function passwordByteLength(value) {
    return new TextEncoder().encode(value).length;
  }

  // Solo dígitos en los campos de cédula
  document.querySelectorAll('input[name="cedula"]').forEach((input) => {
    input.addEventListener('input', () => {
      const clean = input.value.replace(/\D/g, '').slice(0, 10);
      if (clean !== input.value) input.value = clean;
      markInvalid(input, false);
      hideAlert();
    });
  });

  // ---------------------------------------------------------------------
  // Mostrar / ocultar contraseña (sin scripts inline: compatible con CSP)
  // ---------------------------------------------------------------------

  const toggle = document.getElementById('toggle-password');
  const passwordInput = document.getElementById('password');

  if (toggle && passwordInput) {
    toggle.addEventListener('click', () => {
      const show = passwordInput.type === 'password';
      passwordInput.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      toggle.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');

      // Mantiene el cursor al final al cambiar el tipo.
      const end = passwordInput.value.length;
      passwordInput.focus({ preventScroll: true });
      try {
        passwordInput.setSelectionRange(end, end);
      } catch (_) {
        /* algunos navegadores no lo permiten en type=password */
      }
    });
  }

  // ---------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------

  const loginForm = document.getElementById('login-form');

  if (loginForm) {
    const cedulaInput = document.getElementById('cedula');
    const submit = document.getElementById('submit');

    loginForm.addEventListener('input', (event) => {
      if (event.target.matches('input')) {
        markInvalid(event.target, false);
        hideAlert();
      }
    });

    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert();
      clearFormErrors(loginForm);

      const cedula = (cedulaInput.value || '').trim();
      const password = passwordInput.value;

      if (!cedula) {
        markInvalid(cedulaInput, true);
        showAlert('Ingresa tu número de cédula.');
        cedulaInput.focus();
        return;
      }
      if (!/^\d{10}$/.test(cedula)) {
        markInvalid(cedulaInput, true);
        showAlert('La cédula debe tener exactamente 10 dígitos.');
        cedulaInput.focus();
        return;
      }
      if (!password) {
        markInvalid(passwordInput, true);
        showAlert('Ingresa tu contraseña.');
        passwordInput.focus();
        return;
      }

      setLoading(submit, true);
      try {
        await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ cedula, password }),
        });
        showAlert('Sesión iniciada. Redirigiendo...', 'success');
        window.location.assign('/dashboard.html');
      } catch (err) {
        setLoading(submit, false);
        showAlert(err.message);
        if (err.status === 401) {
          markInvalid(passwordInput, true);
          passwordInput.select();
        }
      }
    });
  }

  // ---------------------------------------------------------------------
  // Registro
  // ---------------------------------------------------------------------

  const registerForm = document.getElementById('register-form');

  if (registerForm) {
    const fullNameInput = document.getElementById('fullName');
    const cedulaInput = document.getElementById('cedula');
    const emailInput = document.getElementById('email');
    const submit = document.getElementById('submit');

    registerForm.addEventListener('input', (event) => {
      if (event.target.matches('input')) {
        markInvalid(event.target, false);
        hideAlert();
      }
    });

    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert();
      clearFormErrors(registerForm);

      const fullName = (fullNameInput.value || '').trim().replace(/\s+/g, ' ');
      const cedula = (cedulaInput.value || '').trim();
      const email = (emailInput.value || '').trim().toLowerCase();
      const password = passwordInput.value;

      if (!fullName || !NAME_RE.test(fullName)) {
        markInvalid(fullNameInput, true);
        showAlert('Ingresa tu nombre completo (solo letras y espacios).');
        fullNameInput.focus();
        return;
      }
      if (!isValidCedula(cedula)) {
        markInvalid(cedulaInput, true);
        showAlert(
          cedula.length !== 10
            ? 'La cédula debe tener exactamente 10 dígitos.'
            : 'El número de cédula no es válido.'
        );
        cedulaInput.focus();
        return;
      }
      if (!EMAIL_RE.test(email) || email.length > 254) {
        markInvalid(emailInput, true);
        showAlert('Ingresa un email válido.');
        emailInput.focus();
        return;
      }
      if (password.length < 8) {
        markInvalid(passwordInput, true);
        showAlert('La contraseña debe tener al menos 8 caracteres.');
        passwordInput.focus();
        return;
      }
      if (passwordByteLength(password) > 72) {
        markInvalid(passwordInput, true);
        showAlert('La contraseña es demasiado larga.');
        passwordInput.focus();
        return;
      }

      setLoading(submit, true);
      try {
        await api('/api/register', {
          method: 'POST',
          body: JSON.stringify({ fullName, cedula, email, password }),
        });
        showAlert('Cuenta creada. Redirigiendo...', 'success');
        window.location.assign('/dashboard.html');
      } catch (err) {
        setLoading(submit, false);
        if (err.fields) {
          const fieldMap = {
            fullName: fullNameInput,
            cedula: cedulaInput,
            email: emailInput,
            password: passwordInput,
          };
          Object.keys(err.fields).forEach((key) => markInvalid(fieldMap[key], true));
          const firstKey = Object.keys(err.fields)[0];
          if (fieldMap[firstKey]) fieldMap[firstKey].focus();
        }
        showAlert(err.message);
      }
    });
  }

  // ---------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------

  const logoutButton = document.getElementById('logout');

  if (logoutButton) {
    const avatar = document.getElementById('avatar');
    const greeting = document.getElementById('greeting');
    const nameEl = document.getElementById('p-name');
    const cedulaEl = document.getElementById('p-cedula');
    const emailEl = document.getElementById('p-email');
    const createdEl = document.getElementById('p-created');

    function initials(name) {
      return name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0].toUpperCase())
        .join('');
    }

    function formatDate(value) {
      if (!value) return '—';
      // SQLite guarda "YYYY-MM-DD HH:MM:SS" en UTC.
      const date = new Date(String(value).replace(' ', 'T') + 'Z');
      if (Number.isNaN(date.getTime())) return value;
      return new Intl.DateTimeFormat('es-EC', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(date);
    }

    api('/api/me')
      .then(({ user }) => {
        const name = user.fullName || user.cedula;
        greeting.textContent = `Hola, ${name}`;
        if (avatar) avatar.textContent = initials(name) || '--';
        if (nameEl) nameEl.textContent = name;
        if (cedulaEl) cedulaEl.textContent = user.cedula || '—';
        if (emailEl) emailEl.textContent = user.email || '—';
        if (createdEl) createdEl.textContent = formatDate(user.createdAt);
      })
      .catch((err) => {
        if (err.status === 401) {
          window.location.replace('/login.html');
          return;
        }
        showAlert(err.message);
      });

    logoutButton.addEventListener('click', async () => {
      logoutButton.disabled = true;
      hideAlert();
      try {
        await api('/api/logout', { method: 'POST' });
        window.location.assign('/login.html');
      } catch (err) {
        logoutButton.disabled = false;
        showAlert(err.message);
      }
    });
  }
})();
