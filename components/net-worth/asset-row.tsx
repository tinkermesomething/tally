"use client";

import { useRef, useState, useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverPopup, PopoverPortal, PopoverPositioner } from "@/components/ui/popover";
import { SwatchRow, nativePickerActive } from "@/components/swatch-row";
import { InlineEditText } from "@/components/inline-edit-text";
import { UpdateValueDialog } from "@/components/net-worth/update-value-dialog";
import { removeAsset, renameAsset, setAssetColor } from "@/app/net-worth/actions";
import { formatPence } from "@/lib/money";
import { useAppSettings } from "@/components/providers/app-settings-provider";
import { ASSET_TYPE_ICONS, ASSET_TYPE_LABELS } from "@/lib/asset-types";
import { cn } from "@/lib/utils";
import type { AssetWithValue } from "@/lib/db/assets";

/** Mirrors PersonSettingsRow (components/settings/person-settings-row.tsx)
 * exactly - same colour-dot/rename/archive shape, swapping the debt
 * balance line for the latest valuation and adding the "update value"
 * trigger. */
export function AssetRow({ asset, fallbackColor = "var(--chart-1)" }: { asset: AssetWithValue; fallbackColor?: string }) {
  const { currency } = useAppSettings();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const Icon = ASSET_TYPE_ICONS[asset.type];

  function saveColor(next: string | null) {
    setColorError(null);
    startTransition(async () => {
      try {
        await setAssetColor(asset.id, next);
      } catch (err) {
        setColorError(err instanceof Error ? err.message : "Couldn't save that colour.");
      }
    });
  }

  return (
    <div className="flex items-center justify-between gap-2 row-card rounded-lg bg-card px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`Colour of ${asset.name} in the net worth chart`}
          title="Choose their colour in the net worth chart"
          className="size-4 shrink-0 rounded-full border border-border transition-transform hover:scale-110"
          style={{ backgroundColor: asset.color ?? fallbackColor }}
        />
        <Popover open={open} onOpenChange={(next) => { if (!next && nativePickerActive()) return; setOpen(next); }}>
          <PopoverPortal>
            <PopoverPositioner anchor={anchorRef} align="start" sideOffset={6}>
              <PopoverPopup className="max-w-[calc(100vw-1rem)]">
                <div className="min-w-0 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Colour in the net worth chart</span>
                    <button
                      type="button"
                      aria-pressed={asset.color === null}
                      onClick={() => saveColor(null)}
                      className={cn("rounded-md border px-2 py-0.5 text-xs", asset.color === null ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
                    >
                      Auto
                    </button>
                  </div>
                  <SwatchRow value={asset.color ?? ""} onChange={(c) => saveColor(c)} label={`${asset.name}'s colour`} />
                  <p className="text-xs text-muted-foreground">Auto uses the next colour in the palette.</p>
                  {colorError && <p className="text-xs text-status-critical">{colorError}</p>}
                </div>
              </PopoverPopup>
            </PopoverPositioner>
          </PopoverPortal>
        </Popover>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <InlineEditText value={asset.name} onCommit={(next) => renameAsset(asset.id, next)} className="font-medium" />
          <span className="text-xs text-muted-foreground">
            {ASSET_TYPE_LABELS[asset.type]} · {formatPence(asset.valuePence, currency)}
          </span>
        </div>
      </span>
      <span className="flex items-center gap-1">
        <UpdateValueDialog assetId={asset.id} assetName={asset.name} />
        <Button
          size="icon-xs"
          variant="ghost"
          disabled={pending}
          title="Archive"
          onClick={() => startTransition(() => removeAsset(asset.id))}
        >
          <Archive className="size-3.5 text-chart-2" />
        </Button>
      </span>
    </div>
  );
}
