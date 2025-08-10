// netlify/functions/sendLead.js
export async function handler(event) {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { name, phone, email, note, attributes } = body;

    // 🔐 ваш API‑ключ МойКласс: положите в переменные окружения Netlify
    // Settings → Build & deploy → Environment → MOYKLASS_API_KEY
    const API_KEY = process.env.MOYKLASS_API_KEY || '<подставь_сюда_если_не_используешь_env>';

    // 1) Получаем токен
    const at = await fetch('https://api.moyklass.com/v1/company/auth/getToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: API_KEY })
    });

    if (!at.ok) {
      const t = await at.text();
      throw new Error('Auth error: ' + t);
    }
    const auth = await at.json();
    const token = auth?.token || auth?.accessToken || auth?.access_token;
    if (!token) throw new Error('No token in auth response');

    // 2) Создаём/отправляем пользователя с ПРИЗНАКАМИ
    const payload = {
      name,
      phone,                     // важно: без +
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
      ...(attributes ? { attributes } : {}) // <-- ключевой момент
    };

    const r = await fetch('https://api.moyklass.com/v1/company/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-access-token': token
      },
      body: JSON.stringify(payload)
    });

    // Если уже существует — у некоторых аккаунтов возвращается 409.
    // Считаем это ок, т.к. новый лид уже привязан по телефону.
    if (r.status === 409) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ ok: true, status: 409, message: 'User exists' })
      };
    }

    if (!r.ok) {
      const t = await r.text();
      throw new Error('Create user error: ' + t);
    }

    const data = await r.json();
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, data })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: false, error: String(e.message || e) })
    };
  }
}
