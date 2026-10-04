/** Auto-categorization rule conditions - pure (no DB, no React), so the
 * exact same matching runs on import, in the Review preview and in tests.
 * A rule has one or more conditions and matches only when ALL of them do. */

export type RuleField = "payee" | "amount" | "account";
export type RuleOperator = "contains" | "is" | "gt" | "lt";

/** account: the id of the linked bank account the transaction came from.
 * payee: free text. amount: a positive whole number of PENCE (the sign is
 * the transaction's direction, which a rule's target type already decides,
 * so amounts are always compared by size). */
export type RuleCondition = { field: RuleField; operator: RuleOperator; value: string };

export const OPERATORS_BY_FIELD: Record<RuleField, { value: RuleOperator; label: string }[]> = {
  payee: [
    { value: "contains", label: "contains" },
    { value: "is", label: "is exactly" },
  ],
  amount: [
    { value: "is", label: "is exactly" },
    { value: "gt", label: "is more than" },
    { value: "lt", label: "is less than" },
  ],
  account: [{ value: "is", label: "is" }],
};

export const MAX_CONDITIONS = 6;
const MAX_PAYEE_LENGTH = 200;

/** Bank payee strings pad with runs of spaces ("AMAZON.CO.UK      IE9MD9"),
 * so a rule typed with single spaces must still match - compare with
 * whitespace collapsed and case ignored. */
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True when two payee strings plainly describe the same merchant: equal, or
 * one is a prefix of the other once case/spacing are ignored. A pending
 * transaction's descriptor is a truncated form of the booked one
 * ("TESCO STORES 5439" -> "TESCO STORES 5439 BRANCH GB"), so exact equality
 * is too strict. Both sides need 4+ characters so a stub can't match
 * everything. */
export function payeesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x.length < 4 || y.length < 4) return false;
  return x.startsWith(y) || y.startsWith(x);
}

/** Throws a user-facing Error for anything invalid; returns the cleaned
 * conditions otherwise (payee text trimmed/collapsed, amounts as integer
 * pence strings). This is the only gate rules pass through before being
 * stored, whatever called it. */
export function validateConditions(input: unknown): RuleCondition[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("Add at least one condition.");
  if (input.length > MAX_CONDITIONS) throw new Error(`A rule can have at most ${MAX_CONDITIONS} conditions.`);
  return input.map((raw, i) => {
    const c = raw as Partial<RuleCondition> | null;
    const label = `Condition ${i + 1}`;
    if (!c || (c.field !== "payee" && c.field !== "amount" && c.field !== "account")) {
      throw new Error(`${label}: pick payee, amount or account.`);
    }
    const allowed = OPERATORS_BY_FIELD[c.field].map((o) => o.value);
    if (!c.operator || !allowed.includes(c.operator)) throw new Error(`${label}: that comparison doesn't apply to ${c.field}.`);
    const value = typeof c.value === "string" ? c.value : "";
    if (c.field === "payee") {
      const text = value.replace(/\s+/g, " ").trim();
      if (!text) throw new Error(`${label}: enter some text to match.`);
      if (text.length > MAX_PAYEE_LENGTH) throw new Error(`${label}: text is too long.`);
      return { field: "payee", operator: c.operator, value: text };
    }
    if (c.field === "account") {
      if (!/^\d+$/.test(value.trim()) || parseInt(value, 10) < 1) throw new Error(`${label}: pick an account.`);
      return { field: "account", operator: "is", value: String(parseInt(value, 10)) };
    }
    const pence = value.trim();
    if (!/^\d+$/.test(pence)) throw new Error(`${label}: amount must be a positive number.`);
    return { field: "amount", operator: c.operator, value: String(parseInt(pence, 10)) };
  });
}

/** What the editor holds: amounts in pounds, as typed. */
export type ConditionInput = { field: RuleField; operator: RuleOperator; value: string };

/** Editor -> stored form: converts pounds to pence, then validates. Never
 * throws - the editor shows `error` inline instead. */
export function parseConditionInputs(
  inputs: ConditionInput[]
): { ok: true; conditions: RuleCondition[] } | { ok: false; error: string } {
  try {
    const converted = inputs.map((c, i) => {
      if (c.field !== "amount") return c; // payee text and account ids pass through
      const pounds = parseFloat(c.value);
      if (!c.value.trim() || Number.isNaN(pounds)) throw new Error(`Condition ${i + 1}: amount must be a number.`);
      return { ...c, value: String(Math.round(Math.abs(pounds) * 100)) };
    });
    return { ok: true, conditions: validateConditions(converted) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid rule." };
  }
}

export type MatchableTransaction = {
  payeeRaw: string;
  payeeClean: string | null;
  amountPence: number;
  /** Without it an account condition can't match (never a silent pass). */
  bankAccountId?: number;
};

export function conditionMatches(c: RuleCondition, t: MatchableTransaction): boolean {
  if (c.field === "payee") {
    const wanted = normalizeText(c.value);
    // Either the cleaned or the raw payee - cleanup may not have run, and
    // a rule typed from one shouldn't miss rows only the other shows.
    const haystacks = [t.payeeRaw, t.payeeClean].filter((p): p is string => !!p).map(normalizeText);
    return haystacks.some((h) => (c.operator === "contains" ? h.includes(wanted) : h === wanted));
  }
  if (c.field === "account") return t.bankAccountId !== undefined && t.bankAccountId === parseInt(c.value, 10);
  const size = Math.abs(t.amountPence);
  const wanted = parseInt(c.value, 10);
  if (c.operator === "gt") return size > wanted;
  if (c.operator === "lt") return size < wanted;
  return size === wanted;
}

export function allConditionsMatch(conditions: RuleCondition[], t: MatchableTransaction): boolean {
  return conditions.length > 0 && conditions.every((c) => conditionMatches(c, t));
}

/** A stored rule's conditions - the JSON column when present, otherwise
 * the single legacy field/operator/value (rules saved before stacking). */
export function ruleConditionsOf(rule: {
  field: RuleField;
  operator: RuleOperator;
  value: string;
  conditions: string | null;
}): RuleCondition[] {
  if (rule.conditions) {
    try {
      const parsed = JSON.parse(rule.conditions);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed as RuleCondition[];
    } catch {
      // fall through to the legacy columns
    }
  }
  return [{ field: rule.field, operator: rule.operator, value: rule.value }];
}
