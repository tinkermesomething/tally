"use server";

import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";
import {
  previewRuleMatches,
  createRuleAndCategorize,
  updateRuleAndCategorize,
  type RulePreview,
  type CreateRuleAndApplyResult,
  type RuleTarget,
  type RuleTags,
} from "@/lib/db/bank-sync";
import type { RuleCondition } from "@/lib/rules";

/** Live preview for the Review "Rule" window - read-only. Returns an error
 * string instead of throwing for invalid conditions, so a half-typed rule
 * shows a hint rather than an error screen. */
export async function previewRule(input: {
  conditions: RuleCondition[];
  direction: "expense" | "income" | "ignore";
  /** Set when previewing an edit of this rule. */
  editingRuleId?: number;
  /** Expense rules: the category and tags, to find past expenses missing them. */
  tags?: RuleTags;
}): Promise<{ ok: true; preview: RulePreview } | { ok: false; error: string }> {
  await requireSession();
  try {
    return { ok: true, preview: await previewRuleMatches(input.conditions, input.direction, Number.isInteger(input.editingRuleId) ? input.editingRuleId : undefined, input.tags) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't preview this rule." };
  }
}

export async function saveRule(input: {
  conditions: RuleCondition[];
  target: RuleTarget;
  applyToIds: number[];
  tagExpenseIds?: number[];
}): Promise<{ ok: true; result: CreateRuleAndApplyResult } | { ok: false; error: string }> {
  await requireSession();
  try {
    const ids = Array.isArray(input.applyToIds) ? input.applyToIds.filter((n) => Number.isInteger(n)) : [];
    const tagIds = Array.isArray(input.tagExpenseIds) ? input.tagExpenseIds.filter((n) => Number.isInteger(n)) : [];
    const result = await createRuleAndCategorize({ conditions: input.conditions, target: input.target, applyToIds: ids, tagExpenseIds: tagIds });
    // /review is deliberately NOT revalidated here: the Rule window refreshes
    // it itself once it has closed (see ReviewList.closeRule).
    revalidatePath("/settings");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
    revalidatePath("/savings");
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save this rule." };
  }
}

/** Saves changes to an existing rule (Settings > Rules) and, if asked, applies
 * the changed rule to the waiting transactions that were ticked. */
export async function saveRuleChanges(
  id: number,
  input: { conditions: RuleCondition[]; target: RuleTarget; applyToIds: number[]; tagExpenseIds?: number[] }
): Promise<{ ok: true; result: CreateRuleAndApplyResult } | { ok: false; error: string }> {
  await requireSession();
  try {
    const ids = Array.isArray(input.applyToIds) ? input.applyToIds.filter((n) => Number.isInteger(n)) : [];
    const tagIds = Array.isArray(input.tagExpenseIds) ? input.tagExpenseIds.filter((n) => Number.isInteger(n)) : [];
    const result = await updateRuleAndCategorize(id, { conditions: input.conditions, target: input.target, applyToIds: ids, tagExpenseIds: tagIds });
    revalidatePath("/settings");
    revalidatePath("/review");
    revalidatePath("/grid");
    revalidatePath("/entries");
    revalidatePath("/debt");
    revalidatePath("/savings");
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save this rule." };
  }
}
