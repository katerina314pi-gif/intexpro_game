// netlify/functions/sendLead.js
// Прокси к МойКласс: получает токен по apiKey и создаёт/обновляет пользователя.
// Принимает JSON из браузера вида:
// {
//   "name": "Имя ребёнка",
//   "phone": "79991234567" | "+7 (999) 123-45-67",
//   "email": "optional@ex.com",
//   "note": "любой текст",
//   "attributes": { "parent1": "Имя родителя", "discount": "10" } // ← ВАЖНО: зарезервированные признаки
// }

export async function handler(event) {
  // --- CORS (включая preflight) ---
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors, body: "Only POST" };
  }

  try {
    // ---------- входные данные ----------
    const body = JSON.parse(event.body || "{}");
    let { name, phone, email, note, attributes } = body;

    if (!name) throw new Error("Missing name");
    if (!phone) throw new Error("Missing phone");

    // нормализуем телефон под требования МойКласс: 11 цифр, начинается с 7, без "+"
    phone = String(phone).replace(/\D/g, "");
    if (phone.length === 11 && phone[0] === "8") phone = "7" + phone.slice(1);
    if (phone.length === 10) phone = "7" + phone;
    if (!(phone.length === 11 && phone[0] === "7")) {
      throw new Error("Phone must be 11 digits starting with 7");
    }

    // признаки (зарезервированные ключи в МойКласс)
    // ждём parent1 (имя родителя) и discount (строкой или числом)
    if (attributes && typeof attributes === "object") {
      // приведение скидки к строке безопасно для разных схем
      if (attributes.discount !== undefined) {
        attributes.discount = String(attributes.discount);
      }
    }

    // ---------- ключ и токен ----------
    const API_KEY =
      process.env.MK_API_KEY ||
      process.env.MOYKLASS_API_KEY ||
      "";

    if (!API_KEY) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ ok: false, error: "MK_API_KEY not set in Netlify env" })
      };
    }

    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });

    if (!authRes.ok) {
      const t = await safeText(authRes);
      return {
        statusCode: 401,
        headers: cors,
        body: JSON.stringify({ ok: false, error: `Auth error: ${t}` })
      };
    }

    const auth = await authRes.json().catch(() => ({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) {
      return {
        statusCode: 401,
        headers: cors,
        body: JSON.stringify({ ok: false, error: "Auth error: no token in response" })
      };
    }

    // ---------- создаём/обновляем пользователя ----------
    const payload = {
      name,
      phone,
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
      ...(attributes ? { attributes } : {})
    };

    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": token
      },
      body: JSON.stringify(payload)
    });

    // 409 = пользователь уже существует — принимаем как успех
    if (mkRes.status === 409) {
      return {
        statusCode: 200,
        headers: { ...cors, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, status: 409, message: "User exists" })
      };
    }

    if (!mkRes.ok) {
      const t = await safeText(mkRes);
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ ok: false, error: `Create user error: ${t}` })
      };
    }

    const data = await mkRes.json().catch(() => ({}));
    return {
      statusCode: 200,
      headers: { ...cors, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, data })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) })
    };
  }
}

// аккуратно читаем текст ответа даже если не JSON
async function safeText(res) {
  try { return await res.text(); } catch { return `${res.status}`; }
}
