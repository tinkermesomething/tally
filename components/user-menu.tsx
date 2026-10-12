"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Settings, LogOut } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/settings/user-avatar";

/** The avatar+name in the header is the trigger, not a direct link - open
 * it to get exactly two things: Settings (the standalone top-nav Settings
 * link was removed - this is the only way in now, so it carries the
 * expiring-bank-connection badge that link used to show), and Sign out.
 * `onSignOut` is a server action reference passed down from app-header.tsx
 * (a Server Component) - calling a server action from a plain onClick, not
 * just a <form action>, is the supported way to invoke one from inside a
 * Client Component. */
export function UserMenu({
  userId,
  name,
  email,
  color,
  imageVersion,
  expiringBankAccounts,
  onSignOut,
}: {
  userId: number;
  name: string | null;
  email: string;
  color: string | null;
  imageVersion: number | null;
  expiringBankAccounts: number;
  onSignOut: () => Promise<void>;
}) {
  // Client-side proof of the i18n pipeline, alongside app-header.tsx's
  // server-side getTranslations() - NextIntlClientProvider (app/layout.tsx)
  // only gets genuinely exercised by a "use client" component actually
  // calling useTranslations(); nothing did, until this.
  const t = useTranslations("userMenu");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground transition-colors hover:bg-accent"
            title="Account menu"
          >
            <UserAvatar userId={userId} name={name} email={email} color={color} imageVersion={imageVersion} size={28} />
            <span className="hidden max-w-32 truncate sm:inline">{name || email}</span>
            {expiringBankAccounts > 0 && (
              <span className="flex min-w-[1.25rem] items-center justify-center rounded-full bg-status-critical px-1 text-[0.65rem] font-semibold text-white">
                {expiringBankAccounts}
              </span>
            )}
          </button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem render={<Link href="/settings" />}>
          <Settings className="size-4" />
          {t("settings")}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onSignOut()}>
          <LogOut className="size-4" />
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
