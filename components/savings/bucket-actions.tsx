"use client";

import { useTransition } from "react";
import { Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { removeBucket } from "@/app/savings/actions";

export function ArchiveBucketButton({ bucketId, redirectHome = false }: { bucketId: number; redirectHome?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      disabled={pending}
      title="Archive bucket (history is kept)"
      aria-label="Archive bucket"
      onClick={() =>
        startTransition(async () => {
          await removeBucket(bucketId);
          if (redirectHome) window.location.assign("/savings");
        })
      }
    >
      <Archive className="size-3.5 text-chart-2" />
    </Button>
  );
}
