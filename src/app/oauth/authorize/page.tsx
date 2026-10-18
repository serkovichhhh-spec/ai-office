import { redirect } from "next/navigation";
import { asUser, db } from "@/lib/db";
import { currentUser } from "@/lib/supabase";
import { Logo } from "../../components/ui";
import { approveAction, denyAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

function Problem({ text }: { text: string }) {
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 18 }}><Logo /> AI Office</div>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Підключення неможливе</h1>
        <p className="muted small">{text}</p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = {
    client_id: one(sp.client_id),
    redirect_uri: one(sp.redirect_uri),
    response_type: one(sp.response_type),
    code_challenge: one(sp.code_challenge),
    code_challenge_method: one(sp.code_challenge_method),
    state: one(sp.state),
  };
  const [{ c }] = await db()`select office.oauth_client(${q.client_id}) as c`;
  const client = c as { name: string; redirect_uris: string[] } | null;
  // Never redirect to an address that this client did not register.
  if (!client || !client.redirect_uris.includes(q.redirect_uri)) {
    return <Problem text="Невідомий застосунок або адреса повернення. Почни підключення заново в ChatGPT чи Claude." />;
  }
  if (q.response_type !== "code" || q.code_challenge_method !== "S256" || !q.code_challenge) {
    const u = new URL(q.redirect_uri);
    u.searchParams.set("error", "invalid_request");
    if (q.state) u.searchParams.set("state", q.state);
    redirect(u.toString());
  }

  const user = await currentUser();
  if (!user) {
    const self = `/oauth/authorize?${new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString()}`;
    redirect(`/login?next=${encodeURIComponent(self)}`);
  }
  const workspaces = await asUser(db(), user.id, (tx) =>
    tx`select w.id, w.name from office.workspaces w where office.has_role(w.id, array['owner']) order by w.name`,
  );
  if (workspaces.length === 0) return <Problem text="Підключати виконавців може лише власник workspace." />;
  const guessKind = /claude|anthropic/i.test(client.name) ? "claude_session" : "chatgpt";
  const hidden = ["client_id", "redirect_uri", "code_challenge", "state"] as const;

  return (
    <main className="login" style={{ maxWidth: 460 }}>
      <div className="panel">
        <div className="brand" style={{ marginBottom: 18 }}><Logo /> AI Office</div>
        <h1 style={{ fontSize: 20, marginBottom: 6 }}>Підключити «{client.name}»?</h1>
        <p className="muted small" style={{ marginBottom: 14 }}>
          Застосунок зможе бачити задачі, призначені цьому виконавцю, брати їх у роботу й здавати результати.
          Затверджувати роботу, змінювати бриф чи знання він не зможе. Відключити можна будь-коли.
        </p>
        <form action={approveAction} className="form-grid">
          {hidden.map((k) => <input key={k} type="hidden" name={k} value={q[k]} />)}
          <label>Workspace
            <select name="workspace_id" defaultValue={String(workspaces[0].id)}>
              {workspaces.map((w) => <option key={String(w.id)} value={String(w.id)}>{String(w.name)}</option>)}
            </select>
          </label>
          <label>Хто виконує задачі
            <select name="kind" defaultValue={guessKind}>
              <option value="chatgpt">ChatGPT</option>
              <option value="claude_session">Claude</option>
            </select>
          </label>
          <p className="muted small">Вхід як {user.email}</p>
          <button className="btn approve">Дозволити</button>
        </form>
        <form action={denyAction} style={{ marginTop: 8 }}>
          {hidden.map((k) => <input key={k} type="hidden" name={k} value={q[k]} />)}
          <button className="btn link">Скасувати</button>
        </form>
      </div>
    </main>
  );
}
