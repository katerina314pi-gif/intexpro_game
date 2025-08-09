export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Only POST" };
  }

  const MK_API_KEY = process.env.MK_API_KEY;
  if (!MK_API_KEY) return { statusCode: 500, body: "MK_API_KEY not set" };

  let contact;
  try { contact = JSON.parse(event.body); } 
  catch { return { statusCode: 400, body: "Bad JSON" }; }

  try {
    // 1) токен
    const authRes = await fetch("https://api.moyklass.com/v1/company/auth/getToken", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: MK_API_KEY })
    });
    if (!authRes.ok) throw new Error("Auth " + authRes.status);
    const auth = await authRes.json();
    const token = auth.accessToken || auth.token || auth.access_token;
    if (!token) throw new Error("No token");

    // 2) создать/обновить клиента
    const mkRes = await fetch("https://api.moyklass.com/v1/company/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-access-token": token },
      body: JSON.stringify(contact)
    });
    if (!mkRes.ok && mkRes.status !== 409) {
      const txt = await mkRes.text();
      throw new Error(txt || ("Lead " + mkRes.status));
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ ok: true })
    };
  } catch (e) {
    return { statusCode: 502, body: e.message || "Proxy error" };
  }
}
