import { expectedToken } from "../../middleware";

const COOKIE_NAME = "sfk_auth";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

export default function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    return res.status(200).json({ ok: true }); // gate disabled
  }

  const { password: submitted } = req.body || {};
  if (submitted !== password) {
    return res.status(401).json({ error: "Incorrect password." });
  }

  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${expectedToken(password)}; Path=/; Max-Age=${THIRTY_DAYS}; HttpOnly; SameSite=Lax; Secure`
  );
  res.status(200).json({ ok: true });
}
