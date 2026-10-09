"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Link2, Trash2 } from "lucide-react";
import { SwatchRow } from "@/components/swatch-row";
import { UserAvatar } from "@/components/settings/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runAction } from "@/lib/action-result";
import { updateAvatarColor } from "@/app/settings/actions";
import { uploadAvatarImageAction, fetchAvatarFromUrlAction, removeAvatarImageAction } from "@/app/settings/avatar-actions";

/** Account > avatar: an uploaded (or link-fetched) picture takes priority
 * whenever one's set - the color picker below only ever affects the
 * generated fallback, so it stays usable even while a real image is
 * showing (picking a color doesn't silently replace the image; Remove does
 * that explicitly). */
export function AvatarPicker({
  userId,
  name,
  email,
  color,
  imageVersion,
}: {
  userId: number;
  name: string | null;
  email: string;
  color: string | null;
  imageVersion: number | null;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(color ?? "#2a78d6");
  const [saving, setSaving] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    const err = await runAction(() => uploadAvatarImageAction(form));
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }

  async function onFetchUrl() {
    if (!urlValue.trim()) return;
    setBusy(true);
    setError(null);
    const err = await runAction(() => fetchAvatarFromUrlAction(urlValue.trim()));
    setBusy(false);
    if (err) return setError(err);
    setUrlValue("");
    router.refresh();
  }

  async function onRemove() {
    setBusy(true);
    setError(null);
    const err = await runAction(() => removeAvatarImageAction());
    setBusy(false);
    if (err) return setError(err);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <UserAvatar userId={userId} name={name} email={email} color={current} imageVersion={imageVersion} size={56} />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{saving ? "Saving…" : "Avatar color (used when there's no picture)"}</p>
          <SwatchRow label="Avatar color" value={current} onChange={pick} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFileChosen} />
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload className="size-4" />
          Upload image
        </Button>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Or paste an image link"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            className="h-9 w-56"
            autoComplete="off"
          />
          <Button type="button" size="sm" variant="outline" disabled={busy || !urlValue.trim()} onClick={onFetchUrl}>
            <Link2 className="size-4" />
            Fetch
          </Button>
        </div>
        {imageVersion !== null && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRemove}>
            <Trash2 className="size-4" />
            Remove picture
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPEG, WebP or GIF, 10MB max.</p>
      {error && (
        <p role="alert" className="text-sm text-status-critical">
          {error}
        </p>
      )}
    </div>
  );
}
