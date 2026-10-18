import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase";
import { Logo } from "../components/ui";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 18 }}><Logo /> AI Office</div>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Вхід</h1>
        <p className="muted small" style={{ marginBottom: 16 }}>Той самий акаунт, що й у CMO Space.</p>
        <LoginForm />
      </div>
    </main>
  );
}
