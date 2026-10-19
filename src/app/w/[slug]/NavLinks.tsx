"use client";
import { usePathname } from "next/navigation";

export function NavLinks({ slug,advanced=false }: { slug: string; advanced?:boolean }) {
  const path = usePathname();
  const items = [
    { href: `/w/${slug}`, label: "Офіс", match: (p: string) => p === `/w/${slug}` || p.startsWith(`/w/${slug}/runs`) },
    { href: `/w/${slug}/knowledge`, label: "Знання", match: (p: string) => p.startsWith(`/w/${slug}/knowledge`) },
    ...(advanced?[{href:`/w/${slug}/automation`,label:"Автоматизація",match:(p:string)=>p.startsWith(`/w/${slug}/automation`)}]:[]),
  ];
  return (
    <nav aria-label="Розділи">
      {items.map((i) => (
        <a key={i.href} href={i.href} aria-current={i.match(path) ? "page" : undefined}>{i.label}</a>
      ))}
    </nav>
  );
}
