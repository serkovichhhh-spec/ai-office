"""Builds public/brand/<brand>/manifest.json (stable asset ids + content-hash versions) and the knowledge text for agents.
Run after adding or replacing a file: python3 scripts/brand-manifest.py pavutyna"""
import hashlib, json, sys
from pathlib import Path
from PIL import Image

BASE = "https://ai-office-red.vercel.app"
META = {
  "assets/spider.png": ("pavutyna.mascot", "Маскот-павук, прозорий фон", "Головний герой. Тільки цей файл: не перемальовувати, не змінювати кольори, око-шестикутник, 8 лап, пропорції. Можна: масштаб, дзеркало по горизонталі, обрізання краєм кадру, тінь, відображення, кольорова підсвітка."),
  "assets/logo-white-stacked.png": ("pavutyna.logo.white", "Лого біле з підписом «— телеком-оператор»", "Основне лого на темних макетах. Ширина ≈26–30% полотна, відступ від краю ≥80 px на 1080. Тільки картинкою, не набирати шрифтом."),
  "assets/logo-white-horizontal.png": ("pavutyna.logo.white.horizontal", "Лого біле в рядок", "Вузькі банери, футер."),
  "assets/spider-logo-white.png": ("pavutyna.lockup.white", "Павук + біле лого", "Темні фони, аватар, заставки."),
  "assets/spider-logo-dark.png": ("pavutyna.lockup.dark", "Павук + темне лого", "Світлі фони, документи."),
  "assets/web-glow.png": ("pavutyna.element.web", "Світна павутина (синя/червона)", "Фоновий декор, накладати screen/lighten."),
  "assets/icons-sheet.png": ("pavutyna.icons", "Лінійні іконки й кнопки-стрілки", "Вирізати потрібну; червоні/сині лінійні."),
  "assets/blur-blue.png": ("pavutyna.glow.blue", "Синє світіння", "Підсвітка за об'єктами й текстом."),
  "assets/blur-red.png": ("pavutyna.glow.red", "Червоне світіння", "Підсвітка за об'єктами й текстом."),
  "refs/post-plan-b.jpg": ("pavutyna.ref.post-plan-b", "Еталон: пост «План Б» 1080×1440", "Еталон стилю, не копіювати тексти й ціни."),
  "refs/post-new-addresses.jpg": ("pavutyna.ref.post-new-addresses", "Еталон: пост «Нові адреси»", "Еталон стилю."),
  "refs/post-mega-optika.jpg": ("pavutyna.ref.post-mega-optika", "Еталон: пост MEGA ОПТИКА", "Еталон стилю."),
  "refs/square-gpon-hata.jpg": ("pavutyna.ref.square-gpon-hata", "Еталон: квадрат GPON ХАТА", "Еталон стилю."),
  "refs/square-xgs-10g.jpg": ("pavutyna.ref.square-xgs-10g", "Еталон: квадрат XGS-GPON 10G", "Еталон стилю."),
  "refs/square-warning.jpg": ("pavutyna.ref.square-warning", "Еталон: «Увага, роботи на мережі»", "Еталон стилю."),
  "refs/story-works.jpg": ("pavutyna.ref.story-works", "Еталон: сторіз", "Еталон стилю."),
  "refs/banner-gigabit.jpg": ("pavutyna.ref.banner-gigabit", "Еталон: вузький банер «Незламний гігабіт»", "Еталон стилю."),
  "refs/a4-switch-50.jpg": ("pavutyna.ref.a4", "Еталон: А4 / флаєр", "Еталон стилю для друку."),
  "refs/rollup-inet.jpg": ("pavutyna.ref.rollup", "Еталон: ролап", "Еталон стилю."),
}
FONTS = "fonts/montserrat-{cyrillic,latin}-{500,800,900}-italic.woff2"

brand = sys.argv[1] if len(sys.argv) > 1 else "pavutyna"
root = Path(__file__).resolve().parent.parent / "public" / "brand" / brand
assets = []
for rel, (aid, title, usage) in META.items():
    p = root / rel
    data = p.read_bytes()
    w, h = Image.open(p).size
    assets.append({"id": aid, "version": hashlib.sha256(data).hexdigest()[:12], "title": title, "usage": usage,
                   "kind": rel.split("/")[0].rstrip("s"), "file": rel, "url": f"{BASE}/brand/{brand}/{rel}", "width": w, "height": h})
manifest = {"brand": brand, "rights": "Власні ассети ПАВУТИНИ; використання в рекламі й комунікаціях ПАВУТИНИ затверджене власником бренду.",
            "drive_originals": "https://drive.google.com/drive/folders/1TiRHgN09i1vk6FH0eWjCUWcH14WmLeSz",
            "fonts": {"substitute": "Montserrat Italic (500/800/900)", "brand_font": "Geometria (файлів немає)", "files": f"{BASE}/brand/{brand}/{FONTS}"},
            "assets": assets}
(root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

lines = ["Бібліотека бренд-ассетів ПАВУТИНИ. Використовуй ЛИШЕ ці файли; в asset_uses вказуй asset_id і version точно як тут.",
         "Права: " + manifest["rights"], "Оригінали (PSD/PDF/RAR) — Google Drive власника, папка pavutyna_design.", ""]
for a in assets:
    lines.append(f"- asset_id={a['id']} version={a['version']} · {a['title']} · {a['width']}×{a['height']} · {a['url']}\n  Як використовувати: {a['usage']}")
lines += ["", f"Шрифти: бренд — Geometria (файлів немає); заміна — Montserrat Italic 500/800/900, файли {BASE}/brand/{brand}/fonts/ (cyrillic і latin для кожної ваги).",
          f"Повний перелік у JSON: {BASE}/brand/{brand}/manifest.json"]
(root / "knowledge.txt").write_text("\n".join(lines) + "\n")
print(len(assets), "assets;", len("\n".join(lines)), "chars")
