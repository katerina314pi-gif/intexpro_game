// netlify/functions/sendLead.js
// Принимает из фронта:
// {
//   name: "Имя ребёнка",
//   phone: "79991234567" | "+7 (999) 123-45-67",
//   email: "optional",
//   note: "текст",
//   attributes: [ { name:"parent1", value:"Мама Анна" }, { name:"discount", value:"10" } ]
// }
// Функция сама находит attributeId по названиям признаков (parent1, discount).

export async function handler(event) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Only POST" };

  try {
    const body = JSON.parse(event.body || "{}");
    let { name, phone, email, note, attributes } = body;
    if (!name) throw new Error("Missing name");
    if (!phone) throw new Error("Missing phone");

    // нормализуем телефон под МойКласс: 11 цифр, первая 7
    phone = String(phone).replace(/\D/g, "");
    if (phone.length === 11 && phone[0] === "8") phone = "7" + phone.slice(1);
    if (phone.length === 10) phone = "7" + phone;
    if (!(phone.length === 11 && phone[0] === "7")) {
      return j(400, { ok:false, error:"Phone must be 11 digits starting with 7" });
    }

    // читаем ключ из env (любой из двух)
    const API_KEY = process.env.MK_API_KEY || process.env.MOYKLASS_API_KEY || "";
    if (!API_KEY) return j(500, { ok:false, error:"MK_API_KEY not set in Netlify env" });

    // 1) токен
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method:"POST", headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });
    if (!authRes.ok) return j(401, { ok:false, error:`Auth error: ${await t(authRes)}` });
    const auth = await authRes.json().catch(()=>({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) return j(401, { ok:false, error:"Auth error: no token in response" });

    // 2) найдём ID системных признаков по их коду/имени
    // у разных аккаунтов пути в API могут отличаться, поэтому пробуем несколько
    const attrList = await fetchAttributesList(token);
    if (!Array.isArray(attrList) || !attrList.length) {
      return j(502, { ok:false, error:"Cannot read attributes list from API" });
    }

    // В ответах встречаются поля вида: { id, attributeId, code, name, system, ... }
    // Нас интересуют parent1 и discount. Иногда code = "user.parent1"/"user.discount".
    const parentId = findAttrId(attrList, ["parent1","user.parent1"]);
    const discountId = findAttrId(attrList, ["discount","user.discount"]);

    // Сформируем массив { attributeId, value } из удобного формата
    const outAttrs = [];
    if (Array.isArray(attributes)) {
      for (const a of attributes) {
        if (!a) continue;
        if (typeof a.attributeId === "number") {
          outAttrs.push({ attributeId: a.attributeId, value: a.value != null ? String(a.value) : "" });
        } else if (a.name === "parent1" && parentId) {
          outAttrs.push({ attributeId: parentId, value: a.value != null ? String(a.value) : "" });
        } else if (a.name === "discount" && discountId) {
          outAttrs.push({ attributeId: discountId, value: a.value != null ? String(a.value) : "" });
        }
      }
    }
    // Если что-то из ID не нашли — не падаем, просто не отправляем этот признак.
    // Результат игры всё равно уходит в note.

    // 3) создаём пользователя
    const payload = {
      name, phone,
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
      ...(outAttrs.length ? { attributes: outAttrs } : {})
    };

    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-access-token": token },
      body: JSON.stringify(payload)
    });

    if (mkRes.status === 409) return j(200, { ok:true, status:409, message:"User exists" });
    if (!mkRes.ok) return j(502, { ok:false, error:`Create user error: ${await t(mkRes)}` });

    const data = await mkRes.json().catch(()=>({}));
    return j(200, { ok:true, data });

  } catch (e) {
    return j(500, { ok:false, error: String(e && e.message ? e.message : e) });
  }

  // helpers
  function j(code, obj){ return { statusCode: code, headers:{ ...CORS, "Content-Type":"application/json" }, body: JSON.stringify(obj) }; }
  async function t(res){ try{ return await res.text(); }catch{ return String(res.status); } }

  function findAttrId(list, names){
    const lc = (s)=> (s||"").toString().trim().toLowerCase();
    for (const it of list) {
      const id = Number(it.attributeId || it.id);
      const code = lc(it.code || it.key || it.sysName || it.systemName);
      const name = lc(it.name || it.title);
      if (!Number.isFinite(id)) continue;
      if (names.some(n => lc(n)===code || lc(n)===name)) return id;
      // иногда код бывает "user.parent1", а name — "Родитель"; проверяем вхождения
      if (names.some(n => code.includes(lc(n)))) return id;
    }
    return null;
  }

  async function fetchAttributesList(token){
    const headers = { "x-access-token": token };
    const candidates = [
      "https://api.moyklass.com/v1/company/attributes",
      "https://api.moyklass.com/v1/company/userfields/attributes",
      "https://api.moyklass.com/v1/company/users/attributes"
    ];
    for (const url of candidates) {
      try{
        const r = await fetch(url, { headers });
        if (r.ok) {
          const j = await r.json().catch(()=>null);
          if (Array.isArray(j)) return j;
          if (j && Array.isArray(j.items)) return j.items;
        }
      }catch{}
    }
    return [];
  }
}
