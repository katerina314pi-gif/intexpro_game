// netlify/functions/listAttributes.js
// Возвращает список признаков (attributes) из МойКласс и выдёргивает parent1/discount.
// GET/OPTIONS, CORS открыт.

export async function handler(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: CORS, body: "Only GET" };
  }

  try {
    const API_KEY =
      process.env.MK_API_KEY ||
      process.env.MOYKLASS_API_KEY || "";

    if (!API_KEY) {
      return json(500, { ok:false, error:"MK_API_KEY not set in Netlify env" }, CORS);
    }

    // 1) токен
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method:"POST",
      headers:{ "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });
    if (!authRes.ok) {
      return json(401, { ok:false, error:`Auth error: ${await safeText(authRes)}` }, CORS);
    }
    const auth = await authRes.json().catch(()=> ({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) {
      return json(401, { ok:false, error:"Auth error: no token in response" }, CORS);
    }

    // 2) получаем список признаков
    const headers = { "x-access-token": token };
    const endpoints = [
      "https://api.moyklass.com/v1/company/attributes",
      "https://api.moyklass.com/v1/company/userfields/attributes",
      "https://api.moyklass.com/v1/company/users/attributes"
    ];
    let list = [];
    let used = "";
    for (const url of endpoints) {
      try {
        const r = await fetch(url, { headers });
        if (r.ok) {
          const j = await r.json().catch(()=>null);
          if (Array.isArray(j)) { list = j; used = url; break; }
          if (j && Array.isArray(j.items)) { list = j.items; used = url; break; }
        }
      } catch {}
    }
    if (!list.length) {
      return json(502, { ok:false, error:"Cannot read attributes list from API (no known endpoint matched)" }, CORS);
    }

    // Найти ID по коду/имени
    const lc = s => (s||"").toString().trim().toLowerCase();
    const findId = (names) => {
      for (const it of list) {
        const id = Number(it.attributeId || it.id);
        const code = lc(it.code || it.key || it.sysName || it.systemName);
        const name = lc(it.name || it.title);
        if (!Number.isFinite(id)) continue;
        if (names.some(n => lc(n)===code || lc(n)===name)) return id;
        if (names.some(n => code.includes(lc(n)))) return id;
      }
      return null;
    };

    const parent1Id = findId(["parent1","user.parent1"]);
    const discountId = findId(["discount","user.discount"]);

    return json(200, {
      ok: true,
      endpoint: used,
      count: list.length,
      parent1Id,
      discountId,
      sample: list.slice(0, 10) // чтобы не заваливать ответ — первые 10 как пример
    }, CORS);

  } catch (e) {
    return json(500, { ok:false, error: String(e && e.message ? e.message : e) }, CORS);
  }
}

function json(code, obj, headers) {
  return { statusCode: code, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify(obj) };
}
async function safeText(res) { try { return await res.text(); } catch { return String(res.status); } }
