import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function SupplierManualMatches({ matches, status, error }) {
  if (status === "loading") {
    return (
      <Card className="rounded-2xl border-slate-200 bg-slate-50">
        <CardHeader>
          <CardTitle className="text-base">Supplier Manuals</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Checking supplier manuals...</p>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="rounded-2xl border-amber-200 bg-amber-50">
        <CardHeader>
          <CardTitle className="text-base text-amber-950">Supplier Manuals</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-800">{error || "Unable to load supplier manuals right now."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-slate-200">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Supplier Manuals</CardTitle>
          {matches.length > 0 ? <Badge className="bg-sky-100 text-sky-800">{matches.length} found</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {matches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matching motor or control board manuals were found from the job title, description, notes, or document line items yet.
          </p>
        ) : (
          matches.map((manual) => (
            <div key={manual.id} className="rounded-2xl border bg-slate-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{manual.supplierName}</p>
                  <p className="mt-1 font-semibold text-slate-900">{manual.modelName}</p>
                </div>
                <Button asChild size="sm" className="rounded-lg">
                  <a href={manual.manualUrl} target="_blank" rel="noreferrer">
                    Open Manual
                  </a>
                </Button>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
