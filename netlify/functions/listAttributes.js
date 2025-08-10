// netlify/functions/getUser.js
// GET /.netlify/functions/getUser?userId=123
// optional: &resolveAttributes=1 — попробует подтянуть каталог признаков и расшифровать id → code

export async function handler(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "GET") return { statusCode: 405, headers: CORS, body: "Only GET" };

  try {
    const API_KEY =
      process.env.MK_API_KEY ||
      process.env.MOYKLASS_API_KEY || "";

    if (!API_KEY) {
      return json(500, { ok:false, error:"MK_API_KEY not set in Netlify env" }, CORS);
    }

    const { userId, resolveAttributes } = Object.fromEntries(new URLSearchParams(event.rawQuery || ""));

    if (!userId) {
      return json(400, { ok:false, error:"Query param 'userId' is required" }, CORS);
    }

    // 1) auth token
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });
    if (!authRes.ok) {
      return json(401, { ok:false, error:`Auth error: ${await safeText(authRes)}` }, CORS);
    }
    const auth = await authRes.json().catch(()=> ({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) {
      return json(401, { ok:false, error:"Auth error: no token" }, CORS);
    }

    // 2) user
    const uRes = await fetch(`https://api.moyklass.com/v1/company/users/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers: { "x-access-token": token }
    });
    if (!uRes.ok) {
      return json(404, { ok:false, error:`User fetch error: ${await safeText(uRes)}` }, CORS);
    }
    const user = await uRes.json().catch(()=> ({}));

    // 3) optionally resolve attributes ids → codes
    let resolvedAttributes = null;
    if (resolveAttributes) {
      const catalog = await fetchAttributesList(token);
      if (catalog && catalog.length) {
        const byId = new Map(
          catalog.map(a => [
            Number(a.attributeId ?? a.id),
            (a.code || a.key || a.sysName || a.systemName || a.name || a.title)
          ])
        );
        resolvedAttributes = (user.attributes || []).map(a => ({
          attributeId: a.attributeId ?? a.id,
          code: byId.get(Number(a.attributeId ?? a.id)) || null,
          value: a.value
        }));
      }
    }

    return json(200, {
      ok: true,
      user,
      ...(resolvedAttributes ? { resolvedAttributes } : {})
    }, CORS);

  } catch (e) {
    return json(500, { ok:false, error: String(e && e.message ? e.message : e) }, CORS);
  }
}

function json(code, obj, headers) {
  return { statusCode: code, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify(obj) };
}
async function safeText(res){ try { return await res.text(); } catch { return String(res.status); } }

// Пытаемся найти каталог признаков: у разных аккаунтов путь может отличаться
async function fetchAttributesList(token){
  const headers = { "x-access-token": token };
  const endpoints = [
    "https://api.moyklass.com/v1/company/attributes",
    "https://api.moyklass.com/v1/company/userfields/attributes",
    "https://api.moyklass.com/v1/company/users/attributes"
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) {
        const j = await r.json().catch(()=>null);
        if (Array.isArray(j)) return j;
        if (j && Array.isArray(j.items)) return j.items;
      }
    } catch {}
  }
  return [];
}
