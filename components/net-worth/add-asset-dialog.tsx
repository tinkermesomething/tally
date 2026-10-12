"use client";

import { useState, useTransition } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { createAsset } from "@/app/net-worth/actions";
import { parsePounds } from "@/lib/money-input";
import { ASSET_TYPE_LABELS, type AssetType } from "@/lib/asset-types";

const today = () => new Date().toLocaleDateString("en-CA");

export function AddAssetDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AssetType>("cash");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setName("");
    setType("cash");
    setAmount("");
    setDate(today());
    setError(null);
  };

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter a name.");
    const pounds = parsePounds(amount);
    if (pounds === null || pounds < 0) return setError("Enter a value, e.g. 25 or 25.50.");
    setError(null);
    startTransition(async () => {
      try {
        await createAsset({ name, type, entryDate: date, pounds });
        reset();
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't add that.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); reset(); }}>
      <DialogTrigger render={<Button size="sm" variant="outline"><PlusCircle className="size-4" />Add asset</Button>} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add an asset</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="asset-name">Name</Label>
            <Input id="asset-name" placeholder="e.g. ISA, the car, our house" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-type">Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as AssetType)}>
              <SelectTrigger id="asset-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(ASSET_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-value">Current value (£)</Label>
            <Input id="asset-value" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-date">As of</Label>
            <Input id="asset-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {error && <p className="text-sm text-status-critical">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
