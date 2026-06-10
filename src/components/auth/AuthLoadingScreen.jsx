import { Card, CardContent } from "@/components/ui/card";

export function AuthLoadingScreen({ logoSrc }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-sky-50 px-4 py-10">
      <div className="mx-auto max-w-xl">
        <Card className="rounded-3xl border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
            <div className="rounded-2xl border border-black/5 bg-white px-3 py-2 shadow-sm">
              <img src={logoSrc} alt="Elset logo" className="h-12 w-auto" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Elset</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Loading Workspace</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Restoring your session and syncing the latest shared job data.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
