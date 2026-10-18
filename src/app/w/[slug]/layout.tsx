import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase";
import { listWorkspaces } from "@/lib/queries";
import { Logo } from "../../components/ui";
import { signOutAction } from "../../actions";
import { NavLinks } from "./NavLinks";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser();
  const workspaces = await listWorkspaces(user.id);
  const ws = workspaces.find((w) => w.slug === slug);
  if (!ws) notFound();
  return (
    <>
      <header className="topbar">
        <a className="brand" href={`/w/${ws.slug}`}><Logo /> <span>AI Office</span></a>
        {workspaces.length > 1 ? (
          <nav aria-label="Workspace">
            {workspaces.map((w) => (
              <a key={w.id} href={`/w/${w.slug}`} aria-current={w.slug === slug ? "page" : undefined}>{w.name}</a>
            ))}
          </nav>
        ) : (
          <span className="muted">{ws.name}</span>
        )}
        <NavLinks slug={ws.slug} />
        <span className="spacer" />
        <span className="muted small who">{user.email}</span>
        <form action={signOutAction}><button className="btn link">Вийти</button></form>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
