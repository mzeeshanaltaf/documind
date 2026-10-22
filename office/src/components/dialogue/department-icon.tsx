import {
  FolderIcon,
  GlobeIcon,
  LaptopIcon,
  type LucideIcon,
  type LucideProps,
  PackageIcon,
  ReceiptIcon,
  ScaleIcon,
  UsersIcon,
  WrenchIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  HR: UsersIcon,
  IT: LaptopIcon,
  Finance: ReceiptIcon,
  Procurement: PackageIcon,
  Facilities: WrenchIcon,
  Compliance: ScaleIcon,
  International: GlobeIcon,
};

/** One icon per department (the card picker, the card wallet); a folder for any other. */
export function DepartmentIcon({ department, ...props }: { department: string } & LucideProps) {
  const Icon = ICONS[department] ?? FolderIcon;
  return <Icon aria-hidden {...props} />;
}
