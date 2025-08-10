// netlify/functions/sendLead.js
// Прокси к МойКласс. Принимает:
// {
//   name: "Имя ребёнка",
//   phone: "79991234567",
//   email: "optional",
//   note: "строка",
//   attributes: [ { name:"parent1", value:"Имя родителя" }, { name:"discount", value:"10" } ]
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
    const body = JSON.parse(event.body || "{}");
    let { name, phone, email, note, attributes } = body;

    if (!name) throw new Error("Missing name");
    if (!phone) throw new Error("Missing phone");

    // Нормализуем телефон: 11 цифр, начинается с 7
    phone = String(phone).replace(/\D/g, "");
    if (phone.length === 11 && phone[0] === "8") phone = "7" + phone.slice(1);
    if (phone.length === 10) phone = "7" + phone;
    if (!(phone.length === 11 && phone[0] === "7")) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ ok:false, error:"Phone must be 11 digits starting with 7" }) };
    }

    // ВАЖНО: attributes — массив {name, value}
    if (!Array.isArray(attributes)) attributes = [];
    attributes = attributes
      .filter(a => a && typeof a === "object" && "name" in a)
      .map(a => ({ name: String(a.name), value: a.value != null ? String(a.value) : "" }));

    const API_KEY =
      process.env.MK_API_KEY ||
      process.env.MOYKLASS_API_KEY ||
      "";

    if (!API_KEY) {
      return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:"MK_API_KEY not set in Netlify env" }) };
    }

    // 1) Токен
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: API_KEY })
    });

    if (!authRes.ok) {
      const t = await authRes.text().catch(()=>String(authRes.status));
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok:false, error:`Auth error: ${t}` }) };
    }

    const auth = await authRes.json().catch(()=>({}));
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) {
      return { statusCode: 401, headers: cors, body: JSON.stringify({ ok:false, error:"Auth error: no token in response" }) };
    }

    // 2) Создание пользователя с признаками
    const payload = {
      name,
      phone,
      ...(email ? { email } : {}),
      ...(note ? { note } : {}),
      ...(attributes.length ? { attributes } : {})
    };

    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": token },
      body: JSON.stringify(payload)
    });

    if (mkRes.status === 409) {
      // Уже существует — для нас это успех
      return { statusCode: 200, headers: { ...cors, "Content-Type":"application/json" }, body: JSON.stringify({ ok:true, status:409, message:"User exists" }) };
    }

    if (!mkRes.ok) {
      const t = await mkRes.text().catch(()=>String(mkRes.status));
      return { statusCode: 502, headers: cors, body: JSON.stringify({ ok:false, error:`Create user error: ${t}` }) };
    }

    const data = await mkRes.json().catch(()=>({}));
    return { statusCode: 200, headers: { ...cors, "Content-Type":"application/json" }, body: JSON.stringify({ ok:true, data }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok:false, error:String(e && e.message ? e.message : e) }) };
  }
}
