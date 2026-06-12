import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/FormField";

export function LoginScreen({ loginForm, onFieldChange, onSubmit, error, isLoading, logoSrc }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(15,144,205,0.18),_transparent_34%),linear-gradient(180deg,_#f8fbfd_0%,_#eef5f9_100%)] px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center justify-center">
        <Card className="w-full rounded-[2rem] border-slate-200/80 bg-white/95 shadow-[0_24px_70px_rgba(15,23,42,0.12)] backdrop-blur">
          <CardContent className="p-8 sm:p-10">
            <div className="mb-8 flex flex-col items-center text-center">
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <img src={logoSrc} alt="Elset logo" className="h-14 w-auto" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Elset</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Staff Login</h1>
            </div>
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
