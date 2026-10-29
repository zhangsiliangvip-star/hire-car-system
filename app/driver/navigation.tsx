"use client";

import Link from "next/link";

const sections = [
  { id: "trips", label: "行程", href: "/driver" },
  { id: "report", label: "日報", href: "/driver/report" },
  { id: "finance", label: "财务", href: "/driver/finance" },
  { id: "shifts", label: "シフト", href: "/driver/shifts" },
] as const;

export default function DriverNavigation({ active, busy = false, canLeave }: {
  active?: typeof sections[number]["id"];
  busy?: boolean;
  canLeave?: () => boolean;
}) {
  return <nav className="driver-navigation" aria-label="司机端板块">
    {sections.map(section => <Link key={section.id} href={section.href}
      aria-current={active === section.id ? "page" : undefined}
      aria-disabled={busy || active === section.id ? true : undefined}
      onClick={event => {
        if (busy || active === section.id || (canLeave && !canLeave())) event.preventDefault();
      }}>{section.label}</Link>)}
  </nav>;
}
