// netlify/functions/sendLead.js
// Принимает:
// {
//   name: "Имя ребёнка",
//   phone: "79991234567" | "+7 (999) 123-45-67",
//   email: "optional",
//   note: "текст",
//   // удобный формат с названиями:
//   attributes: [ { name:"parent1", value:"Мама Анна" }, { name:"discount", value:"7" } ]
//   // также поддержим уже «правильный» формат:
//   // attributes: [ { attributeId: 123, value: "..." } ]
// }

export async function handler(event) {
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
    // ---------- вход ----------
    const body = JSON.parse(event.body || "{}");
    let { name, phone, email, note, attributes } = body;

    if (!name) throw new Error("Missing name");
    if (!phone) throw new Error("Missing phone");

    // ---------- нормализуем телефон ----------
    phone = String(phone).replace(/\D/g, "");
    if (phone.length === 11 && phone[0] === "8") phone = "7" + phone.slice(1);
    if (phone.length === 10) phone = "7" + phone;
    if (!(phone.length === 11 && phone[0] === "7")) {
      return resp(400, { ok:false, error:"Phone must be 11 digits starting with 7" }, cors);
    }

    // ---------- маппинг признаков name -> attributeId ----------
    const PARENT1_ID = process.env.ATTR_PARENT1_ID ? Number(process.env.ATTR_PARENT1_ID) : null;
    const DISCOUNT_ID = process.env.ATTR_DISCOUNT_ID ? Number(process.env.ATTR_DISCOUNT_ID) : null;

    let attrsOut = [];
    if (Array.isArray(attributes)) {
      for (const a of attributes) {
        if (!a) continue;

        // уже пришёл правильный формат
        if (typeof a.attributeId === "number") {
          attrsOut.push({ attributeId: a.attributeId, value: a.value != null ? String(a.value) : "" });
          continue;
        }

        // поддержка удобного формата {name, value}
        const nm = (a.name || "").toString().trim().toLowerCase();
        if (nm === "parent1") {
          if (!PARENT1_ID) {
            return resp(500, { ok:false, error:"Set ATTR_PARENT1_ID in Netlify env" }, cors);
          }
          attrsOut.push({ attributeId: PARENT1_ID, value: a.value != null ? String(a.value) : "" });
          continue;
        }
        if (nm === "discount") {
          if (!DISCOUNT_ID) {
            return resp(500, { ok:false, error:"Set ATTR_DISCOUNT_ID in Netlify env" }, cors);
          }
          attrsOut.push({ attributeId: DISCOUNT_ID, value: a.value != null ? String(a.value) : "" });
          continue;
        }
        // если прилетело что-то ещё — игнорим молча
      }
    }

    // ---------- ключ и токен ----------
    const API_KEY =
      process.env.MK_API_KEY ||
      process.env.MOYKLASS_API_KEY || "";

    if (!API_KEY) {
      return resp(500, { ok:false, error:"MK_API_KEY not set in Netlify env" }, cors);
    }

    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });

    if (!authRes.ok) {
      return resp(401, { ok:false, error:`Auth error: ${await safeText(authRes)}` }, cors);
    }
    const auth = await authRes.json().catch(()=> ({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) {
      return resp(401, { ok:false, error:"Auth error: no token in response" }, cors);
    }

    // ---------- создаём пользователя ----------
    const payload = {
      name,
      phone,
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
      ...(attrsOut.length ? { attributes: attrsOut } : {})
    };

    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": token
      },
      body: JSON.stringify(payload)
    });

    if (mkRes.status === 409) {
      // уже существует — ок
      return resp(200, { ok:true, status:409, message:"User exists" }, cors);
    }

    if (!mkRes.ok) {
      return resp(502, { ok:false, error:`Create user error: ${await safeText(mkRes)}` }, cors);
    }

    const data = await mkRes.json().catch(()=> ({}));
    return resp(200, { ok:true, data }, cors);

  } catch (e) {
    return resp(500, { ok:false, error:String(e && e.message ? e.message : e) }, cors);
  }
}

// helpers
function resp(code, obj, cors) {
  return {
    statusCode: code,
    headers: { ...cors, "Content-Type":"application/json" },
    body: JSON.stringify(obj)
  };
}
async function safeText(res) {
  try { return await res.text(); } catch { return String(res.status); }
}
