// Simple shared-password gate. Not per-user auth - one password for anyone
// with the link, stored server-side as DASHBOARD_PASSWORD. If that env var
// isn't set, the gate is skipped entirely (so the dashboard still works
// while you decide whether you need this).

import { NextResponse } from "next/server";

const COOKIE_NAME = "sfk_auth";

export function middleware(req) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next(); // gate disabled if no password set

  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/snapshot") || // cron job has its own auth
    pathname.startsWith("/_next") ||
    pathname.match(/\.(png|jpg|jpeg|svg|ico)$/)
  ) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  if (cookie === expectedToken(password)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

// A lightweight, non-cryptographic token derived from the password, just so
// the cookie value isn't the plaintext password itself. This is a shared
// team password behind an SLT link, not a security boundary against a
// determined attacker - if that threat model changes, use real auth instead.
export function expectedToken(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    hash = (hash << 5) - hash + password.charCodeAt(i);
    hash |= 0;
  }
  return `t${hash}`;
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
