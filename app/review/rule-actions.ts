"use server";

import { revalidatePath } from "next/cache";
import {
  previewRuleMatches,
  createRuleAndCategorize,
  type RulePreview,
  type CreateRuleAndApplyResult,
  type RuleTarget,
} from "@/lib/db/bank-sync";
import type { RuleCondition } from "@/lib/rules";

/** Live preview for the Review "Rule" window - read-only. Returns an error
 * string instead of throwing for invalid conditions, so a half-typed rule
 * shows a hint rather than an error screen. */
export async function previewRule(input: {
  conditions: RuleCondition[];
  direction: "expense" | "income" | "ignore";
}): Promise<{ ok: true; preview: RulePreview } | { ok: false; error: string }> {
  try {
    return { ok: true, preview: await previewRuleMatches(input.conditions, input.direction) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't preview this rule." };
  }
}

export async function saveRule(input: {
  conditions: RuleCondition[];
  target: RuleTarget;
  applyToIds: number[];
}): Promise<{ ok: true; result: CreateRuleAndApplyResult } | { ok: false; error: string }> {
  try {
    const ids = Array.isArray(input.applyToIds) ? input.applyToIds.filter((n) => Number.isInteger(n)) : [];
    const result = await createRuleAndCategorize({ conditions: input.conditions, target: input.target, applyToIds: ids });
    // /review is deliberately NOT revalidated here: the Rule window refreshes
    // it itself once it has closed (see ReviewList.closeRule).
    revalidatePath("/settings");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save this rule." };
  }
}
