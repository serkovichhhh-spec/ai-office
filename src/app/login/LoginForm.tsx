"use client";
import { useActionState } from "react";
import { signInAction, type ActionState } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(signInAction, {});
  return (
    <form action={action} className="form-grid">
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Пароль<input name="password" type="password" autoComplete="current-password" required /></label>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="btn" disabled={pending}>{pending ? "Входимо…" : "Увійти"}</button>
    </form>
  );
}
