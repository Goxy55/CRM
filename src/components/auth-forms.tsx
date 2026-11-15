"use client";
import Link from "next/link";
import { useState } from "react";
import { acceptInvitationAction } from "@/app/actions";
import { Alert, Button, Field, Input } from "./ui";

async function post(path: string, body: unknown): Promise<{ status: number; message?: string }> {
  try {
    const res = await fetch(`/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, message: data?.message };
  } catch {
    return { status: 0 };
  }
}

const NETWORK = "Server trenutno nije dostupan. Pokušajte ponovo.";

export function LoginForm({ next, email }: { next: string; email: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const { status } = await post("/sign-in/email", { email: form.get("email"), password: form.get("password") });
    if (status === 200) return window.location.assign(next);
    setBusy(false);
    setError(
      status === 429
        ? "Previše neuspelih pokušaja. Sačekajte 15 minuta, pa pokušajte ponovo."
        : status === 0
          ? NETWORK
          : "Pogrešna email adresa ili lozinka.",
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <h1 className="text-lg font-semibold">Prijava</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Email adresa" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required defaultValue={email} />
      </Field>
      <Field label="Lozinka" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Prijavljivanje…" : "Prijavi se"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/zaboravljena-lozinka" className="text-brand-700 hover:underline">
          Zaboravili ste lozinku?
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("busy");
    const email = new FormData(e.currentTarget).get("email");
    const { status } = await post("/request-password-reset", { email, redirectTo: "/reset-lozinke" });
    // Ista poruka bez obzira na to da li nalog postoji.
    setState(status === 0 || status >= 500 ? "error" : "sent");
  }
  if (state === "sent")
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Proverite email">
          Ako nalog sa tom adresom postoji, poslali smo link za promenu lozinke. Link važi jedan sat.
        </Alert>
        <Link href="/prijava" className="block text-center text-sm text-brand-700 hover:underline">
          Nazad na prijavu
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">Zaboravljena lozinka</h1>
      <p className="text-sm text-slate-600">Unesite email adresu naloga. Poslaćemo vam link za postavljanje nove lozinke.</p>
      {state === "error" && <Alert tone="error">Slanje poruke trenutno nije moguće. Obratite se administratoru.</Alert>}
      <Field label="Email adresa" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Button type="submit" disabled={state === "busy"} className="w-full">
        {state === "busy" ? "Slanje…" : "Pošalji link"}
      </Button>
      <Link href="/prijava" className="block text-center text-sm text-brand-700 hover:underline">
        Nazad na prijavu
      </Link>
    </form>
  );
}

function PasswordFields() {
  return (
    <>
      <Field label="Nova lozinka" htmlFor="password" hint="Najmanje 12 znakova.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <Field label="Ponovite lozinku" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
    </>
  );
}

function readPassword(form: HTMLFormElement): { password: string; error?: string } {
  const data = new FormData(form);
  const password = String(data.get("password") ?? "");
  if (password.length < 12) return { password, error: "Lozinka mora imati najmanje 12 znakova." };
  if (password !== data.get("confirm")) return { password, error: "Lozinke se ne podudaraju." };
  return { password };
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const { password, error } = readPassword(e.currentTarget);
    if (error) return setError(error);
    setBusy(true);
    const { status } = await post("/reset-password", { newPassword: password, token });
    setBusy(false);
    if (status === 200) setDone(true);
    else setError(status === 0 ? NETWORK : "Link nije važeći ili je istekao. Zatražite novi.");
  }
  if (done)
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Lozinka je promenjena">Sada se možete prijaviti novom lozinkom.</Alert>
        <Link href="/prijava" className="block text-center text-sm text-brand-700 hover:underline">
          Na prijavu
        </Link>
      </div>
    );
  return (
    <form onSubmit={submit} className="space-y-4">
      <h1 className="text-lg font-semibold">Nova lozinka</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <PasswordFields />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Čuvanje…" : "Sačuvaj lozinku"}
      </Button>
    </form>
  );
}

export function AcceptInvitationForm({ token, email, hasAccount }: { token: string; email: string; hasAccount: boolean }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    let password: string | undefined;
    if (!hasAccount) {
      const read = readPassword(e.currentTarget);
      if (read.error) return setError(read.error);
      password = read.password;
    }
    setBusy(true);
    const result = await acceptInvitationAction(token, password);
    if (result.ok) return window.location.assign(`/prijava?email=${encodeURIComponent(email)}`);
    setBusy(false);
    setError(result.error);
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      {hasAccount ? (
        <p className="text-sm text-slate-600">Već imate nalog sa adresom {email}. Prihvatanjem dobijate pristup i ovoj organizaciji; lozinka ostaje ista.</p>
      ) : (
        <>
          <Field label="Email adresa" htmlFor="email">
            <Input id="email" value={email} readOnly disabled autoComplete="username" />
          </Field>
          <PasswordFields />
        </>
      )}
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Aktivacija…" : hasAccount ? "Prihvati pozivnicu" : "Aktiviraj nalog"}
      </Button>
    </form>
  );
}

export function SignOutButton({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await post("/sign-out", {});
        window.location.assign("/prijava");
      }}
    >
      {children}
    </button>
  );
}
