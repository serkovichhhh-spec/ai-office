import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase";
import { Logo } from "../components/ui";
import { LoginForm } from "./LoginForm";
import { safeNext } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await currentUser()) redirect(next);
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 18 }}><Logo /> AI Office</div>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Вхід</h1>
        <p className="muted small" style={{ marginBottom: 16 }}>Той самий акаунт, що й у CMO Space.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
