"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SwatchRow } from "@/components/swatch-row";
import { UserAvatar } from "@/components/settings/user-avatar";
import { updateAvatarColor } from "@/app/settings/actions";

/** Account > avatar: pick a color for your initials circle, saves
 * immediately (same instant-apply feel as the accent-color picker). */
export function AvatarPicker({ name, email, color }: { name: string | null; email: string; color: string | null }) {
  const router = useRouter();
  const [current, setCurrent] = useState(color ?? "#2a78d6");
  const [saving, setSaving] = useState(false);

  async function pick(hex: string) {
    setCurrent(hex);
    setSaving(true);
    try {
      await updateAvatarColor(hex);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <UserAvatar name={name} email={email} color={current} size={48} />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{saving ? "Saving…" : "Avatar color"}</p>
        <SwatchRow label="Avatar color" value={current} onChange={pick} />
      </div>
    </div>
  );
}
