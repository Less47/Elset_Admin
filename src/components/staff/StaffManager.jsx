import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatDate,
  formatLoginAccessRole,
  getSuggestedLoginAccessRole,
  loginAccessRoleOptions,
  toTimestamp,
} from "@/lib/app-support";

function StaffFormDialog({
  open,
  onOpenChange,
  initialStaff,
  onSave,
  canManageLoginAccess = false,
  linkedLoginAccount = null,
  onSaveLoginAccount,
}) {
  const [draftStaff, setDraftStaff] = useState({ name: "", role: "", email: "", phone: "" });
  const [draftLogin, setDraftLogin] = useState({ username: "", role: "technician", password: "", confirmPassword: "" });
  const [isLoginAccessExpanded, setIsLoginAccessExpanded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraftStaff({
      name: initialStaff?.name || "",
      role: initialStaff?.role || "",
      email: initialStaff?.email || "",
      phone: initialStaff?.phone || "",
    });
    setDraftLogin({
      username: linkedLoginAccount?.username || "",
      role: linkedLoginAccount?.role || getSuggestedLoginAccessRole(initialStaff),
      password: "",
      confirmPassword: "",
    });
    setIsLoginAccessExpanded(false);
    setIsSaving(false);
    setSaveError("");
  }, [initialStaff, linkedLoginAccount, open]);

  const showLoginAccessSection = canManageLoginAccess && Boolean(initialStaff);
  const canSave = draftStaff.name.trim().length > 0;
  const suggestedLoginRole = getSuggestedLoginAccessRole(initialStaff);
  const loginUsernameChanged = draftLogin.username.trim() !== String(linkedLoginAccount?.username || "").trim().toLowerCase();
  const loginRoleChanged = draftLogin.role !== (linkedLoginAccount?.role || suggestedLoginRole);
  const wantsLoginAccessUpdate = showLoginAccessSection
    && (
      loginUsernameChanged
      || loginRoleChanged
      || draftLogin.password.trim().length > 0
      || draftLogin.confirmPassword.trim().length > 0
    );
  const loginPasswordProvided = draftLogin.password.trim().length > 0;
  const loginPasswordTooShort = loginPasswordProvided && draftLogin.password.trim().length < 6;
  const loginPasswordsDoNotMatch = draftLogin.password !== draftLogin.confirmPassword;
  const loginUsernameMissing = wantsLoginAccessUpdate && draftLogin.username.trim().length === 0;
  const canSaveLoginAccess = !wantsLoginAccessUpdate
    || (!loginUsernameMissing && !loginPasswordTooShort && !loginPasswordsDoNotMatch);
  const canSubmit = canSave && canSaveLoginAccess && !isSaving;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSaving && onOpenChange(nextOpen)}>
      <DialogContent className="rounded-3xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">{initialStaff ? "Edit Staff Member" : "Add Staff Member"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name">
              <Input value={draftStaff.name} onChange={(e) => setDraftStaff((prev) => ({ ...prev, name: e.target.value }))} />
            </FormField>
            <FormField label="Role">
              <Input value={draftStaff.role} onChange={(e) => setDraftStaff((prev) => ({ ...prev, role: e.target.value }))} placeholder="e.g. Service Technician" />
            </FormField>
            <FormField label="Email">
              <Input value={draftStaff.email} onChange={(e) => setDraftStaff((prev) => ({ ...prev, email: e.target.value }))} />
            </FormField>
            <FormField label="Phone">
              <Input value={draftStaff.phone} onChange={(e) => setDraftStaff((prev) => ({ ...prev, phone: e.target.value }))} />
            </FormField>
          </div>

          {showLoginAccessSection ? (
            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 text-left"
                onClick={() => setIsLoginAccessExpanded((prev) => !prev)}
                aria-expanded={isLoginAccessExpanded}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">Login Access</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {linkedLoginAccount
                      ? `${linkedLoginAccount.username} - ${formatLoginAccessRole(linkedLoginAccount.role)} access`
                      : "Not set"}
                  </p>
                </div>
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                  <ChevronRight className={`h-4 w-4 transition-transform ${isLoginAccessExpanded ? "rotate-90" : ""}`} />
                </span>
              </button>

              {isLoginAccessExpanded ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField label="Username">
                      <Input
                        value={draftLogin.username}
                        onChange={(e) => setDraftLogin((prev) => ({ ...prev, username: e.target.value.toLowerCase() }))}
                        placeholder="e.g. massimo"
                        autoComplete="username"
                      />
                    </FormField>
                    <FormField label="Access role">
                      <Select value={draftLogin.role} onValueChange={(value) => setDraftLogin((prev) => ({ ...prev, role: value }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose access role" />
                        </SelectTrigger>
                        <SelectContent>
                          {loginAccessRoleOptions.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={linkedLoginAccount ? "New password" : "Password"}>
                      <Input
                        type="password"
                        value={draftLogin.password}
                        onChange={(e) => setDraftLogin((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder={linkedLoginAccount ? "Leave blank to keep the current password" : "Enter a temporary password"}
                        autoComplete="new-password"
                      />
                    </FormField>
                    <FormField label={linkedLoginAccount ? "Confirm new password" : "Confirm password"}>
                      <Input
                        type="password"
                        value={draftLogin.confirmPassword}
                        onChange={(e) => setDraftLogin((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                        placeholder="Re-enter the password"
                        autoComplete="new-password"
                      />
                    </FormField>
                  </div>

                  {linkedLoginAccount ? (
                    <p className="text-xs text-slate-500">
                      Current access: <span className="font-medium text-slate-700">{linkedLoginAccount.username}</span> - {formatLoginAccessRole(linkedLoginAccount.role)}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">No login access has been created for this staff member yet.</p>
                  )}
                  <p className="text-xs text-slate-500">Passwords are stored securely and can only be reset, not viewed.</p>

                  {loginUsernameMissing ? <p className="text-sm text-rose-600">Enter a username to save login access.</p> : null}
                  {loginPasswordTooShort ? <p className="text-sm text-rose-600">Passwords must be at least 6 characters.</p> : null}
                  {loginPasswordsDoNotMatch ? <p className="text-sm text-rose-600">Passwords do not match.</p> : null}
                </>
              ) : null}
            </div>
          ) : null}

          {saveError ? <p className="text-sm text-rose-600">{saveError}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={isSaving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={async () => {
              setIsSaving(true);
              setSaveError("");

              try {
                const savedStaff = await Promise.resolve(onSave(draftStaff));
                const resolvedStaff = savedStaff || initialStaff;

                if (showLoginAccessSection && resolvedStaff && wantsLoginAccessUpdate && onSaveLoginAccount) {
                  const loginResult = await onSaveLoginAccount({
                    id: linkedLoginAccount?.id || null,
                    staffId: resolvedStaff.id,
                    staffName: resolvedStaff.name,
                    username: draftLogin.username,
                    role: draftLogin.role,
                    password: draftLogin.password.trim(),
                  });

                  if (!loginResult?.ok) {
                    throw new Error(loginResult?.error || "Unable to save login access.");
                  }
                }

                setIsSaving(false);
                onOpenChange(false);
              } catch (error) {
                setIsSaving(false);
                setSaveError(error instanceof Error ? error.message : "Unable to save staff details.");
              }
            }}
          >
            {isSaving ? "Saving..." : initialStaff ? "Save Staff Member" : "Create Staff Member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffManager({
  staff,
  jobs,
  onCreateStaff,
  onUpdateStaff,
  canManageLogins = false,
  loginAccounts = [],
  loginAccountsError = "",
  onSaveLoginAccount,
}) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name-asc");
  const [staffDialogOpen, setStaffDialogOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const deferredSearch = useDeferredValue(search);

  const loginAccountsByStaffId = useMemo(() => {
    return new Map(
      (Array.isArray(loginAccounts) ? loginAccounts : [])
        .filter((account) => account?.staffId)
        .map((account) => [account.staffId, account])
    );
  }, [loginAccounts]);

  const jobMetricsByStaffId = useMemo(() => {
    return jobs.reduce((map, job) => {
      if (!job.assignedTechnicianId) return map;
      const current = map.get(job.assignedTechnicianId) || {
        assignedJobs: 0,
        openJobs: 0,
        latestUpdatedAt: "",
      };
      const latestUpdatedAt = toTimestamp(job.updatedAt) > toTimestamp(current.latestUpdatedAt)
        ? job.updatedAt
        : current.latestUpdatedAt;
      map.set(job.assignedTechnicianId, {
        assignedJobs: current.assignedJobs + 1,
        openJobs: current.openJobs + (job.status === "Completed" ? 0 : 1),
        latestUpdatedAt,
      });
      return map;
    }, new Map());
  }, [jobs]);

  const staffRows = useMemo(() => {
    return staff.map((staffMember) => {
      const metrics = jobMetricsByStaffId.get(staffMember.id) || {
        assignedJobs: 0,
        openJobs: 0,
        latestUpdatedAt: "",
      };

      return {
        ...staffMember,
        assignedJobs: metrics.assignedJobs,
        openJobs: metrics.openJobs,
        latestUpdatedAt: metrics.latestUpdatedAt,
        loginAccount: loginAccountsByStaffId.get(staffMember.id) || null,
      };
    });
  }, [jobMetricsByStaffId, loginAccountsByStaffId, staff]);

  const filteredStaff = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = staffRows.filter((staffMember) =>
      query
        ? [staffMember.name, staffMember.role, staffMember.email, staffMember.phone, staffMember.loginAccount?.username, staffMember.loginAccount?.role]
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true
    );

    rows.sort((a, b) => {
      if (sortBy === "name-desc") return b.name.localeCompare(a.name);
      if (sortBy === "role") return (a.role || "").localeCompare(b.role || "") || a.name.localeCompare(b.name);
      if (sortBy === "jobs-most") return b.assignedJobs - a.assignedJobs || a.name.localeCompare(b.name);
      if (sortBy === "activity-recent") return toTimestamp(b.latestUpdatedAt) - toTimestamp(a.latestUpdatedAt);
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [deferredSearch, sortBy, staffRows]);

  const staffStats = useMemo(() => {
    return {
      totalStaff: staffRows.length,
      assignedStaff: staffRows.filter((staffMember) => staffMember.assignedJobs > 0).length,
      openAssignments: staffRows.reduce((total, staffMember) => total + staffMember.openJobs, 0),
      missingEmail: staffRows.filter((staffMember) => !staffMember.email).length,
      withLoginAccess: staffRows.filter((staffMember) => staffMember.loginAccount).length,
    };
  }, [staffRows]);

  return (
    <>
      <Card className="overflow-hidden rounded-xl border-slate-300 shadow-none">
        <CardHeader className="space-y-4 border-b border-slate-200 bg-slate-50 px-5 py-5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <CardTitle className="text-lg">Staff Management</CardTitle>
              <p className="mt-1 text-sm text-slate-600">
                {canManageLogins
                  ? "Keep staff contact details, roles, workload, and admin-only login access in one shared directory."
                  : "Keep staff contact details, roles, and assignment workload in one shared directory."}
              </p>
            </div>
            <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center">
              <div>
                Showing <span className="font-semibold text-slate-900">{filteredStaff.length}</span> of {staffStats.totalStaff} staff records
              </div>
              <Button
                className="rounded-lg"
                onClick={() => {
                  setEditingStaff(null);
                  setStaffDialogOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Staff
              </Button>
            </div>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_220px_auto]">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
              <Input
                className="rounded-lg border-slate-300 bg-white"
                placeholder={canManageLogins ? "Search by name, role, email, phone, or username..." : "Search by name, role, email, or phone..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="rounded-lg border-slate-300 bg-white">
                  <SelectValue placeholder="Sort staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Alphabetical A-Z</SelectItem>
                  <SelectItem value="name-desc">Alphabetical Z-A</SelectItem>
                  <SelectItem value="role">Role</SelectItem>
                  <SelectItem value="jobs-most">Most assignments</SelectItem>
                  <SelectItem value="activity-recent">Recent activity</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                className="w-full rounded-lg border-slate-300 bg-white xl:w-auto"
                onClick={() => {
                  setSearch("");
                  setSortBy("name-asc");
                }}
              >
                Reset Filters
              </Button>
            </div>
          </div>
        </CardHeader>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 md:grid-cols-4">
          {[
            { label: "Total staff", value: staffStats.totalStaff },
            { label: "With assignments", value: staffStats.assignedStaff },
            { label: "Open assignments", value: staffStats.openAssignments },
            { label: canManageLogins ? "With login access" : "Missing email", value: canManageLogins ? staffStats.withLoginAccess : staffStats.missingEmail },
          ].map((stat) => (
            <div key={stat.label} className="bg-white px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{stat.label}</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{stat.value}</p>
            </div>
          ))}
        </div>

        <CardContent className="p-0">
          {canManageLogins && loginAccountsError ? (
            <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">
              Unable to load login access details right now: {loginAccountsError}
            </div>
          ) : null}

          {filteredStaff.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No staff found"
                text="Try adjusting the search, or add a new staff member to start assigning jobs."
                action={(
                  <Button
                    className="rounded-lg"
                    onClick={() => {
                      setEditingStaff(null);
                      setStaffDialogOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Staff
                  </Button>
                )}
              />
            </div>
          ) : (
            <div className="overflow-x-auto bg-white">
              <div className="min-w-[1120px]">
                <div className="grid grid-cols-[1.45fr_1.1fr_1.1fr_1fr_120px_90px_90px_130px] border-b border-slate-200 bg-slate-100 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  <span>Staff Member</span>
                  <span>Role</span>
                  <span>Email</span>
                  <span>Phone</span>
                  <span>Created</span>
                  <span className="text-right">Assigned</span>
                  <span className="text-right">Open</span>
                  <span className="text-right">Action</span>
                </div>

                {filteredStaff.map((staffMember, index) => (
                  <div
                    key={staffMember.id}
                    className={`grid grid-cols-[1.45fr_1.1fr_1.1fr_1fr_120px_90px_90px_130px] items-center px-5 py-3 text-sm transition hover:bg-slate-50 ${
                      index !== filteredStaff.length - 1 ? "border-b border-slate-200" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-950">{staffMember.name}</p>
                      <div className="mt-1 flex gap-2 text-xs text-slate-500">
                        <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{staffMember.id.slice(0, 8)}</span>
                        <span className="truncate">{staffMember.latestUpdatedAt ? `Last active ${formatDate(staffMember.latestUpdatedAt)}` : "No job activity yet"}</span>
                      </div>
                    </div>
                    <p className="truncate text-slate-700">{staffMember.role || "Not set"}</p>
                    <p className="truncate text-slate-700">{staffMember.email || "Not set"}</p>
                    <p className="truncate text-slate-700">{staffMember.phone || "Not set"}</p>
                    <p className="text-slate-700">{formatDate(staffMember.createdAt)}</p>
                    <div className="text-right">
                      <span className="font-medium text-slate-950">{staffMember.assignedJobs}</span>
                    </div>
                    <div className="text-right">
                      <span className="font-medium text-slate-950">{staffMember.openJobs}</span>
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-md border-slate-300"
                        onClick={() => {
                          setEditingStaff(staffMember);
                          setStaffDialogOpen(true);
                        }}
                      >
                        Edit Staff
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <StaffFormDialog
        open={staffDialogOpen}
        onOpenChange={setStaffDialogOpen}
        initialStaff={editingStaff}
        linkedLoginAccount={editingStaff ? loginAccountsByStaffId.get(editingStaff.id) || null : null}
        canManageLoginAccess={canManageLogins}
        onSaveLoginAccount={onSaveLoginAccount}
        onSave={(staffInput) => {
          if (editingStaff) {
            return onUpdateStaff(editingStaff.id, staffInput);
          }

          return onCreateStaff(staffInput);
        }}
      />
    </>
  );
}
