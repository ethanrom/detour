"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { LogoMark } from "@/components/Logo";
import { PageMenu } from "./PageMenu";
import type { WorkbenchApi } from "./useWorkbench";

interface Props {
  wb: WorkbenchApi;
  menu: { open: boolean; focus: "pages" | "field" };
  onMenu: (open: boolean, restoreFocus?: boolean) => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  /** Under 1280 px the page column is a drawer, opened from here. */
}

/** The mark, the page name (the h1), what the numbers are made of, "Change page", and the Method link. */
export function TopBar({ wb, menu, onMenu, menuButtonRef }: Props) {
  const { site, sites, status, address } = wb;
  const menuId = "page-menu";

  return (
    // From 768 px up: one row. Under it: the page and "Change page" on the first row, the status and the links on the second.
    <header className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-0.5 px-1">
      <Link href="/" aria-label="Detour, home" className="inline-flex h-11 shrink-0 items-center gap-2 text-ink no-underline max-md:order-1">
        <LogoMark size={24} />
        <span className="text-base font-semibold leading-none tracking-[-0.02em] max-sm:sr-only">Detour</span>
      </Link>
      <span aria-hidden="true" className="h-5 w-px shrink-0 bg-rule-strong max-md:order-1" />
      <h1 className="min-w-0 truncate text-base font-semibold leading-tight max-md:order-1 max-md:flex-1">{site?.name ?? "Analyze a page"}</h1>
      <p role="status" title={status.detail} className="min-w-0 truncate text-xs leading-4 text-muted max-md:order-4 max-md:flex-1">
        {status.text}
      </p>
      <div className="relative max-md:order-2">
        <button
          ref={menuButtonRef}
          type="button"
          className="btn btn-sm"
          aria-haspopup="dialog"
          aria-expanded={menu.open}
          aria-controls={menu.open ? menuId : undefined}
          onClick={() => onMenu(!menu.open)}
        >
          Change page
        </button>
        {menu.open && sites && (
          <PageMenu
            id={menuId}
            sites={sites}
            siteId={wb.site?.id ?? ""}
            focus={menu.focus}
            address={address}
            onAddress={wb.setAddressText}
            onSubmitAddress={() => void wb.submitAddress().then((ok) => ok && onMenu(false, true))}
            onChoose={wb.chooseSite}
            onClose={(restore) => onMenu(false, restore)}
            anchorRef={menuButtonRef}
          />
        )}
      </div>
      <span aria-hidden="true" className="order-3 basis-full md:hidden" />
      <div className="ml-auto flex items-center gap-1 max-md:order-5">
        <Link href="/method" className="inline-flex min-h-9 items-center rounded-md px-3 text-sm font-medium text-ink">
          Method
        </Link>
      </div>
    </header>
  );
}
