import { redirect } from "next/navigation";

/** Entries merged into /review as its "Logged" tab - this keeps old
 * bookmarks/links working instead of 404ing. */
export default async function EntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const { year, month } = await searchParams;
  const params = new URLSearchParams({ tab: "logged" });
  if (year) params.set("year", year);
  if (month) params.set("month", month);
  redirect(`/review?${params.toString()}`);
}
