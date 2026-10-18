import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { listWorkspaces } from "@/lib/queries";
import { Logo } from "./components/ui";
import { signOutAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  if (workspaces.length === 1) redirect(`/w/${workspaces[0].slug}`);
  return (
    <main className="login">
      <div className="panel">
        <div className="brand" style={{ marginBottom: 14 }}><Logo /> AI Office</div>
        {workspaces.length === 0 ? (
          <>
            <h1 style={{ fontSize: 20 }}>Немає доступу до жодного workspace</h1>
            <p className="muted" style={{ marginTop: 8 }}>
              Ви увійшли як {user.email}. Попросіть власника workspace додати вас.
            </p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 12 }}>Оберіть workspace</h1>
            <ul className="list">
              {workspaces.map((w) => (
                <li key={w.id}><a className="row" href={`/w/${w.slug}`}><span className="row-main row-title">{w.name}</span><span className="row-meta">{w.role}</span></a></li>
              ))}
            </ul>
          </>
        )}
        <form action={signOutAction} style={{ marginTop: 16 }}><button className="btn link">Вийти</button></form>
      </div>
    </main>
  );
}
