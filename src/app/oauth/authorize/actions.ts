"use server";
import { redirect } from "next/navigation";
import { asUser, db } from "@/lib/db";
import { currentUser } from "@/lib/supabase";

function back(redirectUri: string, params: Record<string, string>): never {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  redirect(u.toString());
}

/** Owner approved: issue a one-time code bound to (client, redirect_uri, PKCE challenge, executor). */
export async function approveAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const f = (k: string) => String(form.get(k) ?? "");
  const redirectUri = f("redirect_uri");
  // The database re-checks that redirect_uri is registered for this client before anything is issued.
  const [{ code }] = await asUser(db(), user.id, (tx) =>
    tx`select office.oauth_authorize(${f("client_id")}, ${redirectUri}, ${f("code_challenge")}, ${f("workspace_id")}::uuid, ${f("kind")}) as code`,
  );
  back(redirectUri, { code: code as string, state: f("state") });
}

export async function denyAction(form: FormData): Promise<void> {
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const [{ c }] = await db()`select office.oauth_client(${clientId}) as c`;
  const uris = ((c as { redirect_uris?: string[] } | null)?.redirect_uris ?? []);
  if (!uris.includes(redirectUri)) redirect("/");
  back(redirectUri, { error: "access_denied", state: String(form.get("state") ?? "") });
}
