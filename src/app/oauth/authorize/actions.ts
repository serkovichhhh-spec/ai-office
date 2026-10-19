"use server";
import { redirect } from "next/navigation";
import { asUser, db } from "@/lib/db";
import { currentUser } from "@/lib/supabase";

function back(redirectUri: string, params: Record<string, string>): never {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  redirect(u.toString());
}

const ERRORS: Array<[RegExp, string]> = [
  [/label required/, "label"],
  [/label already used/, "label_taken"],
  [/executor not found/, "executor"],
  [/only the workspace owner/, "owner"],
];

/**
 * Owner approved: issue a one-time code bound to (client, redirect_uri, PKCE challenge, executor).
 * The owner either creates a NEW executor with its own label or reconnects an existing one —
 * two ChatGPT accounts behind the same OAuth client are never merged into one executor.
 */
export async function approveAction(form: FormData): Promise<void> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const f = (k: string) => String(form.get(k) ?? "");
  const redirectUri = f("redirect_uri");
  const target = f("target");
  const existing = /^[0-9a-f-]{36}$/i.test(target) ? target : null;
  let code: string;
  try {
    let workspaceId = f("workspace_id");
    if (existing) {
      const rows = await asUser(db(), user.id, (tx) => tx`select workspace_id::text as w from office.executors where id = ${existing}::uuid`);
      if (!rows.length) throw new Error("executor not found");
      workspaceId = String(rows[0].w);
    }
    // The database re-checks owner role, redirect_uri, PKCE, label format and uniqueness.
    const [row] = await asUser(db(), user.id, (tx) =>
      tx`select office.oauth_authorize(${f("client_id")}, ${redirectUri}, ${f("code_challenge")}, ${workspaceId}::uuid,
                                       ${f("kind")}, ${existing}::uuid, ${existing ? null : f("label")}) as code`,
    );
    code = row.code as string;
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    const err = ERRORS.find(([re]) => re.test(msg))?.[1] ?? "failed";
    const retry = new URLSearchParams(f("back"));
    retry.set("err", err);
    redirect(`/oauth/authorize?${retry.toString()}`);
  }
  back(redirectUri, { code, state: f("state") });
}

export async function denyAction(form: FormData): Promise<void> {
  const clientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const [{ c }] = await db()`select office.oauth_client(${clientId}) as c`;
  const uris = ((c as { redirect_uris?: string[] } | null)?.redirect_uris ?? []);
  if (!uris.includes(redirectUri)) redirect("/");
  back(redirectUri, { error: "access_denied", state: String(form.get("state") ?? "") });
}
