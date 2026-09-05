import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { FormField } from "@/components/shared/FormField";
import {
  CompactSortControl,
  PagePrimaryAction,
  PageSearchField,
  ResponsivePageControls,
  ResultSummary,
} from "@/components/shared/ResponsivePageControls";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

const staffSortOptions = [
  { value: "name-asc", label: "A-Z" },
  { value: "name-desc", label: "Z-A" },
  { value: "role", label: "Role" },
  { value: "created-recent", label: "Newest" },
];

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

  const staffRows = useMemo(() => {
    return staff.map((staffMember) => ({
      ...staffMember,
      loginAccount: loginAccountsByStaffId.get(staffMember.id) || null,
    }));
  }, [loginAccountsByStaffId, staff]);

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
      if (sortBy === "created-recent") return toTimestamp(b.createdAt) - toTimestamp(a.createdAt);
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [deferredSearch, sortBy, staffRows]);

  const staffStats = useMemo(() => {
    return {
      totalStaff: staffRows.length,
      missingEmail: staffRows.filter((staffMember) => !staffMember.email).length,
      missingPhone: staffRows.filter((staffMember) => !staffMember.phone).length,
      completeProfiles: staffRows.filter((staffMember) => staffMember.email && staffMember.phone).length,
      withLoginAccess: staffRows.filter((staffMember) => staffMember.loginAccount).length,
    };
  }, [staffRows]);

  return (
    <>
      <div className="space-y-4">
        <ResponsivePageControls
          search={(
            <PageSearchField value={search} onChange={setSearch} placeholder="Search staff..." label="Search staff" />
          )}
          controls={<CompactSortControl value={sortBy} onValueChange={setSortBy} options={staffSortOptions} label="Sort staff" />}
          action={(
            <PagePrimaryAction onClick={() => { setEditingStaff(null); setStaffDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Staff
            </PagePrimaryAction>
          )}
          summary={<ResultSummary>{filteredStaff.length} staff {filteredStaff.length === 1 ? "member" : "members"}</ResultSummary>}
        />

        <div className="floating-page-toolbar hidden px-4 py-3 xl:block">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1.35fr)_minmax(155px,0.75fr)_minmax(130px,0.65fr)] md:items-end">
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Search</p>
              <Input
                className="data-toolbar-field rounded-lg border-slate-300 bg-white"
                placeholder={canManageLogins ? "Search by name, role, email, phone, or username..." : "Search by name, role, email, or phone..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sort by</p>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="data-toolbar-field rounded-lg border-slate-300 bg-white">
                  <SelectValue placeholder="Sort staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Alphabetical A-Z</SelectItem>
                  <SelectItem value="name-desc">Alphabetical Z-A</SelectItem>
                  <SelectItem value="role">Role</SelectItem>
                  <SelectItem value="created-recent">Newest staff</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="h-11 self-end rounded-lg px-5"
              onClick={() => {
                setEditingStaff(null);
                setStaffDialogOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Add Staff
            </Button>
          </div>
        </div>

        <Card className="data-card gap-0 overflow-hidden rounded-xl border-slate-300 shadow-none">
        <div className="data-stat-grid hidden gap-px border-b border-slate-200 bg-slate-200 xl:grid xl:grid-cols-4">
          {[
            { label: "Total staff", value: staffStats.totalStaff },
            { label: "Missing email", value: staffStats.missingEmail },
            { label: "Missing phone", value: staffStats.missingPhone },
            { label: canManageLogins ? "With login access" : "Complete profiles", value: canManageLogins ? staffStats.withLoginAccess : staffStats.completeProfiles },
          ].map((stat) => (
            <div key={stat.label} className="data-stat-card bg-white px-5 py-4">
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
                text="Try adjusting the search, or add a new staff member."
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
            <>
              <div className="overflow-x-auto text-xs 2xl:hidden">
                <div className="data-grid grid min-w-[520px] gap-px bg-slate-200 md:min-w-0">
                  <div className="data-grid-header grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_82px] gap-px bg-slate-200 font-semibold uppercase tracking-[0.12em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-3 [&>*]:py-2">
                    <span>Staff</span>
                    <span>Contact</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredStaff.map((staffMember) => (
                    <div
                      key={staffMember.id}
                      className="data-grid-row grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_82px] gap-px bg-slate-200 transition [&>*]:bg-white [&>*]:px-3 [&>*]:py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">{staffMember.name}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{staffMember.role || "Role not set"}</p>
                      </div>
                      <div className="min-w-0 text-slate-700">
                        <p className="truncate">{staffMember.email || "No email"}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{staffMember.phone || "No phone"}</p>
                      </div>
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 rounded-md border-slate-300 px-2 text-[11px]"
                          onClick={() => {
                            setEditingStaff(staffMember);
                            setStaffDialogOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="hidden overflow-x-auto 2xl:block">
              <div className="min-w-[1120px]">
                <div className="data-grid grid gap-px bg-slate-200">
                  <div className="data-grid-header grid grid-cols-[1.45fr_1.1fr_1.1fr_1fr_120px_130px] gap-px bg-slate-200 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 [&>*]:bg-slate-100 [&>*]:px-5 [&>*]:py-3">
                    <span>Staff Member</span>
                    <span>Role</span>
                    <span>Email</span>
                    <span>Phone</span>
                    <span>Created</span>
                    <span className="text-right">Action</span>
                  </div>

                  {filteredStaff.map((staffMember) => (
                    <div
                      key={staffMember.id}
                      className="data-grid-row grid grid-cols-[1.45fr_1.1fr_1.1fr_1fr_120px_130px] gap-px bg-slate-200 text-sm transition [&>*]:bg-white [&>*]:px-5 [&>*]:py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-950">{staffMember.name}</p>
                        <div className="mt-1 flex gap-2 text-xs text-slate-500">
                          <span className="shrink-0 font-mono uppercase tracking-[0.12em]">{staffMember.id.slice(0, 8)}</span>
                        </div>
                      </div>
                      <p className="truncate text-slate-700">{staffMember.role || "Not set"}</p>
                      <p className="truncate text-slate-700">{staffMember.email || "Not set"}</p>
                      <p className="truncate text-slate-700">{staffMember.phone || "Not set"}</p>
                      <p className="text-slate-700">{formatDate(staffMember.createdAt)}</p>
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
              </div>
            </>
          )}
        </CardContent>
        </Card>
      </div>

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
