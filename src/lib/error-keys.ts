/**
 * Stable snake_case message keys for business-rule violations and validation
 * failures. The server fails with them as tagged errors (sent as the
 * TRPCError message), schema checks carry them as their message, and the
 * client translates them (messages: "errors.<key>").
 */
export const ERROR_KEYS = [
  "type_change_not_supported",
  "fields_integrity_not_expense_category",
  "fields_integrity_not_income_category",
  "fields_integrity_same_account_transfer",
  "fields_integrity_self_parent",
  "fields_integrity_parent_not_allowed",
  "fields_integrity_parent_has_parent",
  "email_not_unique",
  "invalid_otp",
  "otp_attempts_exceeded",
  "upload_count_exceeded",
  "is_nonempty",
  "weekdays_required",
  "incorrect_weekday",
  "start_date_lte_end_date",
  "end_date_gte_start_date",
  "is_minor_units",
  // added in v2; the keys above carry over from v1
  "invite_invalid",
  "not_found",
  "forbidden",
  "account_name_not_unique",
  "account_currency_locked",
  "account_has_transactions",
  "account_is_debt",
  "category_has_children",
  "category_kind_required",
  "category_parent_has_children",
  "category_replace_self",
  "category_replace_kind_mismatch",
  "counterparty_name_not_unique",
  "counterparty_in_use",
  "counterparty_merge_self",
  "counterparty_required",
  "share_user_not_found",
  "share_self",
  "share_debt_account",
  "invalid_password",
  "invalid_code",
  "last_admin",
  "recovery_link_invalid",
  "import_invalid",
  "import_accounts_in_use",
  "import_empty_row",
  "unknown_currency",
  "amount_sign",
  "not_planned",
  "not_recurring",
  "adjust_balance_changed",
  // validation messages carried by the Effect Schema checks
  "name_too_short",
  "password_too_short",
  "too_long",
  "invalid_email",
  "invalid_date",
  "invalid_value",
] as const;

export type ErrorKey = (typeof ERROR_KEYS)[number];

export const isErrorKey = (value: unknown): value is ErrorKey =>
  typeof value === "string" &&
  (ERROR_KEYS as readonly string[]).includes(value);
