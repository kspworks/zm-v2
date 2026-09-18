
CREATE TYPE public.account_types AS ENUM (
    'cash',
    'card',
    'account',
    'credit',
    'deposit',
    'debt'
);

CREATE TYPE public.entity_actions AS ENUM (
    'create',
    'update',
    'delete',
    'restore'
);

CREATE TYPE public.entity_types AS ENUM (
    'accounts',
    'categories',
    'planned_transactions',
    'transactions'
);

CREATE TYPE public.planned_transactions_repeat_types AS ENUM (
    'daily',
    'weekly',
    'monthly',
    'yearly'
);

CREATE TYPE public.user_types AS ENUM (
    'admin',
    'user'
);

CREATE TABLE public.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);

CREATE SEQUENCE public.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.__drizzle_migrations_id_seq OWNED BY public.__drizzle_migrations.id;

CREATE TABLE public.accounts (
    id character varying(24) NOT NULL,
    name character varying(255) NOT NULL,
    type public.account_types NOT NULL,
    currency_id character varying(24) NOT NULL,
    initial_balance integer NOT NULL,
    current_balance integer NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    import_id character varying(24),
    created_by character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    usage integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.accounts_users (
    account_id character varying(24) NOT NULL,
    user_id character varying(24) NOT NULL,
    can_read boolean NOT NULL,
    can_write boolean NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.auth_accounts (
    user_id character varying(24) NOT NULL,
    type character varying(255) NOT NULL,
    provider character varying(255) NOT NULL,
    provider_account_id character varying(255) NOT NULL,
    refresh_token text,
    access_token text,
    expires_at integer,
    token_type character varying(255),
    scope character varying(255),
    id_token text,
    session_state character varying(255)
);

CREATE TABLE public.auth_attempts (
    key character varying(255) NOT NULL,
    count integer NOT NULL,
    window_start timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.auth_sessions (
    session_token character varying(255) NOT NULL,
    user_id character varying(24) NOT NULL,
    expires timestamp with time zone NOT NULL
);

CREATE TABLE public.auth_verification_tokens (
    identifier character varying(255) NOT NULL,
    token character varying(255) NOT NULL,
    expires timestamp with time zone NOT NULL
);

CREATE TABLE public.categories (
    id character varying(24) NOT NULL,
    parent_id character varying(24),
    name character varying(255) NOT NULL,
    is_income boolean NOT NULL,
    is_expense boolean NOT NULL,
    import_id character varying(24),
    created_by character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.categories_users (
    category_id character varying(24) NOT NULL,
    user_id character varying(24) NOT NULL,
    can_read boolean NOT NULL,
    can_write boolean NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.currencies (
    id character varying(24) NOT NULL,
    sign character varying(4) NOT NULL,
    code character varying(4) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.history_logs (
    id character varying(24) NOT NULL,
    entity_type public.entity_types NOT NULL,
    entity_id character varying(24) NOT NULL,
    entity_action public.entity_actions NOT NULL,
    user_id character varying(24) NOT NULL,
    payload json NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE public.imports (
    id character varying(24) NOT NULL,
    user_id character varying(24) NOT NULL,
    file_name character varying(255) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone
);

CREATE TABLE public.invites (
    id character varying(48) NOT NULL,
    otp_secret character varying(255) NOT NULL,
    user_id character varying(24),
    created_by character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    comment character varying(255)
);

CREATE TABLE public.planned_transactions (
    id character varying(24) NOT NULL,
    batch_id character varying(24),
    start_date date NOT NULL,
    end_date date,
    repeat_type public.planned_transactions_repeat_types NOT NULL,
    repeat_interval smallint NOT NULL,
    repeat_weekdays smallint[] NOT NULL,
    amount integer NOT NULL,
    account_id character varying(24) NOT NULL,
    category_id character varying(24),
    comment character varying(500),
    payee character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    created_by character varying(24) NOT NULL
);

CREATE TABLE public.transactions (
    id character varying(24) NOT NULL,
    batch_id character varying(24),
    date date NOT NULL,
    amount integer NOT NULL,
    account_id character varying(24) NOT NULL,
    category_id character varying(24),
    comment character varying(500),
    payee character varying(255),
    planned_transaction_id character varying(24),
    is_planned boolean DEFAULT false NOT NULL,
    import_id character varying(24),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    created_by character varying(24) NOT NULL,
    planned_hash character varying(32)
);

CREATE TABLE public.users (
    id character varying(24) NOT NULL,
    name character varying(255),
    email character varying(255) NOT NULL,
    email_verified timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    image character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    password character varying(255),
    type public.user_types DEFAULT 'user'::public.user_types NOT NULL,
    otp_secret character varying(255),
    locale character varying(5) DEFAULT 'ua'::character varying NOT NULL
);

ALTER TABLE ONLY public.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('public.__drizzle_migrations_id_seq'::regclass);

ALTER TABLE ONLY public.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auth_accounts
    ADD CONSTRAINT auth_accounts_provider_provider_account_id_pk PRIMARY KEY (provider, provider_account_id);

ALTER TABLE ONLY public.auth_attempts
    ADD CONSTRAINT auth_attempts_pkey PRIMARY KEY (key);

ALTER TABLE ONLY public.auth_sessions
    ADD CONSTRAINT auth_sessions_pkey PRIMARY KEY (session_token);

ALTER TABLE ONLY public.auth_verification_tokens
    ADD CONSTRAINT auth_verification_tokens_identifier_token_pk PRIMARY KEY (identifier, token);

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_code_unique UNIQUE (code);

ALTER TABLE ONLY public.currencies
    ADD CONSTRAINT currencies_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.history_logs
    ADD CONSTRAINT history_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.imports
    ADD CONSTRAINT imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.invites
    ADD CONSTRAINT invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.planned_transactions
    ADD CONSTRAINT planned_transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX accounts_created_by_idx ON public.accounts USING btree (created_by);

CREATE INDEX accounts_import_id_idx ON public.accounts USING btree (import_id);

CREATE INDEX accounts_is_active_idx ON public.accounts USING btree (is_active);

CREATE UNIQUE INDEX accounts_name_currency_created_by_active_unique ON public.accounts USING btree (name, currency_id, created_by) WHERE (deleted_at IS NULL);

CREATE INDEX accounts_users_account_id_idx ON public.accounts_users USING btree (account_id);

CREATE UNIQUE INDEX accounts_users_account_user_active_unique ON public.accounts_users USING btree (account_id, user_id) WHERE (deleted_at IS NULL);

CREATE INDEX accounts_users_can_read_idx ON public.accounts_users USING btree (can_read);

CREATE INDEX accounts_users_can_write_idx ON public.accounts_users USING btree (can_write);

CREATE INDEX accounts_users_user_id_idx ON public.accounts_users USING btree (user_id);

CREATE INDEX auth_accounts_user_id_idx ON public.auth_accounts USING btree (user_id);

CREATE INDEX auth_sessions_user_id_idx ON public.auth_sessions USING btree (user_id);

CREATE INDEX categories_created_by_idx ON public.categories USING btree (created_by);

CREATE INDEX categories_import_id_idx ON public.categories USING btree (import_id);

CREATE INDEX categories_is_expense_idx ON public.categories USING btree (is_expense);

CREATE INDEX categories_is_income_idx ON public.categories USING btree (is_income);

CREATE INDEX categories_parent_id_idx ON public.categories USING btree (parent_id);

CREATE INDEX categories_users_can_read_idx ON public.categories_users USING btree (can_read);

CREATE INDEX categories_users_can_write_idx ON public.categories_users USING btree (can_write);

CREATE INDEX categories_users_category_id_idx ON public.categories_users USING btree (category_id);

CREATE UNIQUE INDEX categories_users_category_user_active_unique ON public.categories_users USING btree (category_id, user_id) WHERE (deleted_at IS NULL);

CREATE INDEX categories_users_user_id_idx ON public.categories_users USING btree (user_id);

CREATE INDEX history_logs_entity_action_idx ON public.history_logs USING btree (entity_action);

CREATE INDEX history_logs_entity_id_idx ON public.history_logs USING btree (entity_id);

CREATE INDEX history_logs_entity_type_idx ON public.history_logs USING btree (entity_type);

CREATE INDEX history_logs_user_id_idx ON public.history_logs USING btree (user_id);

CREATE INDEX imports_user_id_idx ON public.imports USING btree (user_id);

CREATE INDEX invites_created_by_idx ON public.invites USING btree (created_by);

CREATE INDEX invites_user_id_idx ON public.invites USING btree (user_id);

CREATE INDEX planned_transactions_account_id_idx ON public.planned_transactions USING btree (account_id);

CREATE INDEX planned_transactions_amount_idx ON public.planned_transactions USING btree (amount);

CREATE INDEX planned_transactions_batch_id_idx ON public.planned_transactions USING btree (batch_id);

CREATE INDEX planned_transactions_category_id_idx ON public.planned_transactions USING btree (category_id);

CREATE INDEX planned_transactions_created_by_idx ON public.planned_transactions USING btree (created_by);

CREATE INDEX planned_transactions_payee_idx ON public.planned_transactions USING btree (payee);

CREATE INDEX transactions_account_id_idx ON public.transactions USING btree (account_id);

CREATE INDEX transactions_amount_idx ON public.transactions USING btree (amount);

CREATE INDEX transactions_batch_id_idx ON public.transactions USING btree (batch_id);

CREATE INDEX transactions_category_id_idx ON public.transactions USING btree (category_id);

CREATE INDEX transactions_comment_idx ON public.transactions USING btree (comment);

CREATE INDEX transactions_created_by_idx ON public.transactions USING btree (created_by);

CREATE INDEX transactions_date_idx ON public.transactions USING btree (date);

CREATE INDEX transactions_import_id_idx ON public.transactions USING btree (import_id);

CREATE INDEX transactions_is_planned_idx ON public.transactions USING btree (is_planned);

CREATE INDEX transactions_payee_idx ON public.transactions USING btree (payee);

CREATE INDEX transactions_planned_hash ON public.transactions USING btree (planned_hash);

CREATE INDEX transactions_planned_transaction_id_idx ON public.transactions USING btree (planned_transaction_id);

CREATE UNIQUE INDEX users_email_active_unique ON public.users USING btree (lower((email)::text)) WHERE (deleted_at IS NULL);

CREATE INDEX users_email_idx ON public.users USING btree (email);

