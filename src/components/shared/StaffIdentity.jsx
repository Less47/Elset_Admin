import StaffAvatar from "./StaffAvatar";

export default function StaffIdentity({ staff, name = staff?.name || "Unassigned", size = "sm" }) {
  return <span className="inline-flex min-w-0 items-center gap-2"><StaffAvatar staff={staff} name={name} size={size} /><span className="truncate">{name}</span></span>;
}
