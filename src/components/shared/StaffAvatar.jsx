import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { staffInitials } from "@/lib/workspace-media";

export default function StaffAvatar({ staff, name = staff?.name || "", className = "", size = "default" }) {
  return <Avatar size={size} className={className} aria-label={`${name || "Staff"} profile photo`}>
    {staff?.avatarUrl ? <AvatarImage src={staff.avatarUrl} alt={name} loading="lazy" /> : null}
    <AvatarFallback>{staff?.initials || staffInitials(name)}</AvatarFallback>
  </Avatar>;
}
