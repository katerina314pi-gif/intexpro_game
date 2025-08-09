export async function handler(event) {
  // ----- CORS (включая preflight) -----
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Only POST" };
  }

  const MK_API_KEY = process.env.MK_API_KEY;
  if (!MK_API_KEY) {
    return { statusCode: 500, headers: corsHeaders, body: "MK_API_KEY not set" };
  }

  let contact;
  try {
    contact = JSON.parse(event.body); // { name, phone, email?, note }
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: "Bad JSON" };
  }

  try {
    // 1) Получаем токен
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: MK_API_KEY })
    });
    if (!authRes.ok) throw new Error("Auth " + authRes.status);

    const auth = await authRes.json();
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) throw new Error("No token");

    // 2) Создаём/обновляем клиента
    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-access-token": token
      },
      body: JSON.stringify(contact)
    });

    // 409 — уже существует, считаем успехом
    if (!mkRes.ok && mkRes.status !== 409) {
      const txt = await mkRes.text();
      throw new Error(txt || ("Lead " + mkRes.status));
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    return { statusCode: 502, headers: corsHeaders, body: e.message || "Proxy error" };
  }
}
