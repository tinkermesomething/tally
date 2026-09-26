"use client";

import { Check, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCENTS } from "@/lib/accent";
import { useAccent } from "@/components/providers/accent-provider";

export function AccentPicker() {
  const { accent, setAccent } = useAccent();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Choose accent color">
            <Palette className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {ACCENTS.map((option) => (
          <DropdownMenuItem
            key={option.id}
            onClick={() => setAccent(option.id)}
            className="flex items-center gap-2"
          >
            <span
              className="size-3 rounded-full border border-border"
              style={{ backgroundColor: option.swatch }}
            />
            <span className="flex-1">{option.label}</span>
            {accent === option.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
