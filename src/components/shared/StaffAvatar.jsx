import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { staffInitials } from "@/lib/workspace-media";

export default function StaffAvatar({ staff, name = staff?.name || "", initials, className = "", size = "default", decorative = false }) {
  return <Avatar size={size} className={className} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `${name || "Staff"} profile photo`}>
    {/* Keep the image mounted so Radix resets its loaded state when a photo is removed. */}
    <AvatarImage src={staff?.avatarUrl || undefined} alt={decorative ? "" : name} loading="lazy" />
    <AvatarFallback>{initials || staff?.initials || staffInitials(name)}</AvatarFallback>
  </Avatar>;
}
