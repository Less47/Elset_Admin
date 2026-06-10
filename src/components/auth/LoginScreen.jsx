import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";

const demoAccounts = [
  { label: "Admin", username: "admin", password: "admin123", role: "Full access" },
  { label: "Office", username: "office", password: "office123", role: "Office access" },
  { label: "Massimo", username: "massimo", password: "tech123", role: "Technician access" },
  { label: "Domenic", username: "domenic", password: "tech123", role: "Technician access" },
];

export function LoginScreen({ loginForm, onFieldChange, onSubmit, error, isLoading, logoSrc }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-sky-50 px-4 py-10">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Card className="overflow-hidden rounded-3xl border-none bg-slate-900 text-white shadow-xl">
          <CardContent className="p-8 md:p-10">
            <div className="flex items-center gap-4">
              <div className="rounded-2xl border border-black/5 bg-white px-3 py-2 shadow-sm">
                <img src={logoSrc} alt="Elset logo" className="h-12 w-auto" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-slate-300">Elset</p>
                <h1 className="text-2xl font-semibold tracking-tight">Admin Access</h1>
              </div>
            </div>
            <p className="mt-6 max-w-xl text-sm leading-7 text-slate-300 md:text-base">
              Sign in with your staff account to access the shared live job data. Office users see the full workspace, while technicians only see their own assigned jobs.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {demoAccounts.map((account) => (
                <div key={account.username} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="font-semibold">{account.label}</p>
                  <p className="mt-1 text-sm text-slate-300">{account.role}</p>
                  <div className="mt-3 space-y-1 text-sm text-slate-200">
                    <p><span className="text-slate-400">Username:</span> {account.username}</p>
                    <p><span className="text-slate-400">Password:</span> {account.password}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl">Sign In</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-5" onSubmit={handleSubmit}>
              <FormField label="Username">
                <Input
                  value={loginForm.username}
                  onChange={(event) => onFieldChange("username", event.target.value)}
                  placeholder="Enter your username"
                  autoComplete="username"
                />
              </FormField>
              <FormField label="Password">
                <Input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) => onFieldChange("password", event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
              </FormField>
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
              <Button type="submit" className="rounded-2xl" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
