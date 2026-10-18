import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL / publishable key are not configured");
  return { url, key };
}

/** Supabase client bound to the request cookies. Used ONLY for auth; data goes through Postgres + RLS. */
export async function supabaseServer() {
  const store = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}

export interface SessionUser {
  id: string;
  email: string | null;
}

/** Verified user (getUser validates the token with Supabase Auth) or null. */
export async function currentUser(): Promise<SessionUser | null> {
  // Local UI preview only (`next dev` against a local database). Production builds always set
  // NODE_ENV=production, so this branch can never run on Vercel.
  if (process.env.NODE_ENV === "development" && process.env.LOCAL_DEV_USER_ID) {
    return { id: process.env.LOCAL_DEV_USER_ID, email: "local-dev@example.test" };
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}
