CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    account_type VARCHAR(20) NOT NULL DEFAULT 'savings',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, account_type),
    CONSTRAINT chk_non_negative_balance CHECK (balance >= 0)
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    receiver_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    amount NUMERIC(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'completed',
    description TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_positive_amount CHECK (amount > 0),
    CONSTRAINT chk_different_accounts CHECK (sender_account_id <> receiver_account_id),
    CONSTRAINT chk_valid_status CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver ON transactions(receiver_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);

-- Dedicated Idempotency Keys table for safe HTTP retries and cached response replay
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(255) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_path VARCHAR(255) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_lookup ON idempotency_keys(user_id, key);

-- Dedicated Audit Logs table for security and compliance tracking
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id UUID,
    request_id VARCHAR(255),
    status VARCHAR(20) NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_request_id ON audit_logs(request_id);