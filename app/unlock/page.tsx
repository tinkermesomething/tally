import { redirect } from "next/navigation";
import { desktopLockActive } from "@/lib/desktop/lock";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { UnlockForm } from "./unlock-form";

// Desktop only: the app lock's password screen (see lib/desktop/lock.ts).
// Reached by a window that is still locked; with no lock set there is
// nothing to unlock, so it goes to the app.
export const dynamic = "force-dynamic";

export default function UnlockPage() {
  if (!desktopLockActive()) redirect("/grid");
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-center text-xl">Tally</CardTitle>
          <CardDescription className="text-center">Enter your password to open your budget.</CardDescription>
        </CardHeader>
        <CardContent>
          <UnlockForm />
        </CardContent>
      </Card>
    </div>
  );
}
