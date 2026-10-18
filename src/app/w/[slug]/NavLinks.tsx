"use client";
import { usePathname } from "next/navigation";

export function NavLinks({ slug }: { slug: string }) {
  const path = usePathname();
  const items = [
    { href: `/w/${slug}`, label: "Офіс", match: (p: string) => p === `/w/${slug}` || p.startsWith(`/w/${slug}/runs`) },
    { href: `/w/${slug}/knowledge`, label: "Знання", match: (p: string) => p.startsWith(`/w/${slug}/knowledge`) },
  ];
  return (
    <nav aria-label="Розділи">
      {items.map((i) => (
        <a key={i.href} href={i.href} aria-current={i.match(path) ? "page" : undefined}>{i.label}</a>
      ))}
    </nav>
  );
}
