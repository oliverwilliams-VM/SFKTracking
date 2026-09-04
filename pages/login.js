import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";

export default function Login() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Something went wrong.");
      }
      router.push(typeof router.query.from === "string" ? router.query.from : "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Funded SFK Install Programme</title>
      </Head>
      <div className="login-page">
        <form className="login-card" onSubmit={submit}>
          <h1>Funded SFK Install Programme</h1>
          <p className="login-sub">Enter the shared password to continue.</p>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={loading || !password}>
            {loading ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
      <style jsx>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #0b0d10;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .login-card {
          background: #15181d;
          border: 1px solid #262b31;
          border-radius: 14px;
          padding: 2.5rem;
          width: 320px;
          text-align: center;
        }
        h1 {
          color: #f2f4f6;
          font-size: 1.15rem;
          margin: 0 0 0.5rem;
        }
        .login-sub {
          color: #99a2ab;
          font-size: 0.85rem;
          margin: 0 0 1.5rem;
        }
        input {
          width: 100%;
          padding: 0.65rem 0.85rem;
          border-radius: 8px;
          border: 1px solid #262b31;
          background: #1b1f25;
          color: #f2f4f6;
          font-size: 0.95rem;
          margin-bottom: 1rem;
        }
        .login-error {
          color: #f87171;
          font-size: 0.85rem;
          margin: -0.5rem 0 1rem;
        }
        button {
          width: 100%;
          padding: 0.7rem;
          border-radius: 999px;
          border: none;
          background: #8b5cf6;
          color: white;
          font-weight: 600;
          font-size: 0.95rem;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.6;
          cursor: default;
        }
      `}</style>
    </>
  );
}
