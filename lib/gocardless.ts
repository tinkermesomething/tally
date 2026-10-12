// Thin client for GoCardless Bank Account Data (formerly Nordigen) - real API
// confirmed against https://docs.gocardless.com/bank-account-data, not
// assumed. Access tokens are fetched fresh via /token/new/ and cached in
// memory for their 24h lifetime; no need to juggle refresh tokens across
// restarts since re-fetching from secret_id/secret_key is free and the
// secret itself doesn't expire.

const BASE_URL = "https://bankaccountdata.gocardless.com/api/v2";

/** GoCardless's own redirect back to our `redirect` URL carries no query
 * params we can rely on - some banks' Open Banking implementations strip
 * query strings from the redirect entirely (a known community-documented
 * gotcha, and consistent with actual-budget's own setup reusing one static
 * redirect URL with no per-request params - see the 36 historical
 * requisitions pulled from this same account, every one pointed at the
 * literal same URL). So correlation state travels in an httpOnly cookie
 * set right before sending the user away, not in anything GoCardless hands
 * back. */
export const PENDING_CONNECTION_COOKIE = "gc_pending_connection";

export type PendingConnection = {
  /** Whoever started this connection - the callback checks the SIGNED-IN
   * user still matches this before applying it (see bank-sync-callback's
   * own comment). */
  userId: number;
  requisitionId: string;
  institutionId: string;
  institutionName: string;
  accessValidForDays: number;
};

// One credential pair for the whole instance (lib/db/gocardless-credentials.ts),
// so one cached token is enough - invalidated below whenever the secretId
// it was fetched for no longer matches (an admin replaced the credentials).
let tokenCache: { secretId: string; token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Dynamic import: this module has no other reason to touch the database
  // at all (credentials live in the shared keystore now, not a per-user
  // connection) - a plain top-level import would work too, this just keeps
  // the one DB dependency obvious at the call site in an otherwise-pure
  // HTTP client module.
  const { getGocardlessCredentials } = await import("./db/gocardless-credentials");
  const creds = await getGocardlessCredentials();
  if (!creds) {
    throw new Error("GoCardless isn't set up yet - an admin needs to add the API credentials in Settings > Admin.");
  }

  if (tokenCache && tokenCache.secretId === creds.secretId && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }
  const res = await fetch(`${BASE_URL}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id: creds.secretId, secret_key: creds.secretKey }),
  });
  if (!res.ok) {
    throw new Error(`GoCardless token request failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  // access_expires is in seconds; shave 60s off as a safety margin.
  tokenCache = { secretId: creds.secretId, token: data.access, expiresAt: Date.now() + (data.access_expires - 60) * 1000 };
  return tokenCache.token;
}

async function gcFetch(path: string, init?: RequestInit) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`GoCardless API error on ${path}: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export type GcInstitution = {
  id: string;
  name: string;
  bic: string;
  logo: string;
  // Per-institution caps - confirmed by testing live: requesting
  // max_historical_days above an institution's own transaction_total_days
  // is a hard 400 ("must be > 0 and <= <institution> transaction_total_days
  // (N)"), not silently clamped. Every agreement must be built from the
  // SAME institution's own numbers, never a hardcoded constant.
  transaction_total_days: number;
  max_access_valid_for_days: number;
};

export async function listInstitutions(country: string): Promise<GcInstitution[]> {
  return gcFetch(`/institutions/?country=${encodeURIComponent(country)}`);
}

export async function createAgreement(institution: {
  id: string;
  transaction_total_days: number;
  max_access_valid_for_days: number;
}): Promise<{ id: string; access_valid_for_days: number }> {
  return gcFetch(`/agreements/enduser/`, {
    method: "POST",
    body: JSON.stringify({
      institution_id: institution.id,
      max_historical_days: String(institution.transaction_total_days),
      access_valid_for_days: String(institution.max_access_valid_for_days),
      access_scope: ["balances", "details", "transactions"],
    }),
  });
}

export async function createRequisition(input: {
  institutionId: string;
  agreementId: string;
  redirectUrl: string;
  reference: string;
}): Promise<{ id: string; link: string }> {
  return gcFetch(`/requisitions/`, {
    method: "POST",
    body: JSON.stringify({
      institution_id: input.institutionId,
      agreement: input.agreementId,
      redirect: input.redirectUrl,
      reference: input.reference,
      user_language: "EN",
    }),
  });
}

export type GcRequisition = {
  id: string;
  status: string;
  institution_id: string;
  accounts: string[];
};

export async function getRequisition(id: string): Promise<GcRequisition> {
  return gcFetch(`/requisitions/${id}/`);
}

export type GcAccountMeta = {
  id: string;
  iban: string | null;
  institution_id: string;
  owner_name: string | null;
  name: string | null;
};

export async function getAccountMeta(accountId: string): Promise<GcAccountMeta> {
  return gcFetch(`/accounts/${accountId}/`);
}

export type GcTransaction = {
  // Not every bank supplies transactionId; GoCardless then only guarantees
  // internalTransactionId (per GoCardless's published schema - re-check if a
  // bank's rows ever stage with the wrong id).
  transactionId?: string;
  internalTransactionId?: string;
  // bookingDate is only present on BOOKED transactions - a pending one
  // hasn't been recorded/posted yet, so it has no booking date at all,
  // only valueDate (confirmed via GoCardless's own docs, not assumed -
  // this type is shared between both arrays getAccountTransactions
  // returns). Both already ISO YYYY-MM-DD.
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  creditorName?: string;
  debtorName?: string;
};

/** dateFrom narrows to transactions booked on/after that date (ISO), for
 * incremental sync - omit for a full/initial pull (bounded by the
 * agreement's max_historical_days regardless). */
export async function getAccountTransactions(
  accountId: string,
  dateFrom?: string
): Promise<{ booked: GcTransaction[]; pending: GcTransaction[] }> {
  const query = dateFrom ? `?date_from=${dateFrom}` : "";
  const data = await gcFetch(`/accounts/${accountId}/transactions/${query}`);
  return data.transactions;
}

/** GoCardless amounts are decimal STRINGS ("-12.34") - parsing via
 * parseFloat()*100 can reproduce exactly the float-rounding artifact this
 * app's data model exists to avoid (see the schema's own pence-integer
 * rule). Split on the decimal point and work in integers instead. */
export function gcAmountToPence(amount: string): number {
  const negative = amount.startsWith("-");
  const unsigned = negative ? amount.slice(1) : amount;
  const [whole, fraction = ""] = unsigned.split(".");
  const paddedFraction = (fraction + "00").slice(0, 2);
  const pence = parseInt(whole, 10) * 100 + parseInt(paddedFraction || "0", 10);
  return negative ? -pence : pence;
}

export type GcBalance = {
  balanceAmount: { amount: string; currency: string };
  balanceType: string;
  referenceDate?: string;
};

export async function getAccountBalances(accountId: string): Promise<GcBalance[]> {
  const data = await gcFetch(`/accounts/${accountId}/balances/`);
  return data.balances;
}

/** One balance to show as "the" balance, when a bank reports several
 * (booked vs. pending, available vs. expected) - confirmed via GoCardless's
 * own docs that `interimAvailable` is the closest to "what you could spend
 * right now", with `expected` (includes pending) as the fallback most
 * banks report instead. Any other type (or none at all) falls back to
 * whatever came first, rather than showing nothing. */
export function pickBalance(balances: GcBalance[]): GcBalance | null {
  if (balances.length === 0) return null;
  return (
    balances.find((b) => b.balanceType === "interimAvailable") ??
    balances.find((b) => b.balanceType === "expected") ??
    balances[0]
  );
}

export function payeeFromTransaction(t: GcTransaction): string {
  return t.creditorName || t.debtorName || t.remittanceInformationUnstructured || "Unknown payee";
}

/** Only for BOOKED transactions. Returns null (never throws, never writes an
 * "undefined" date into the DB) for one that has no usable id or date, so the
 * caller can skip it without losing the rest of the batch. A booked item
 * normally has bookingDate; valueDate is the fallback GoCardless documents. */
export function toRawImportedTransaction(t: GcTransaction) {
  const importedId = t.transactionId ?? t.internalTransactionId;
  const bookingDate = t.bookingDate ?? t.valueDate;
  if (!importedId || !bookingDate) return null;
  return {
    importedId,
    amountPence: gcAmountToPence(t.transactionAmount.amount),
    bookingDate,
    payeeRaw: payeeFromTransaction(t),
  };
}
