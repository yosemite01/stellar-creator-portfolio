-- Add hash-chain fields to AuditLog
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "entryHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditLog" ADD COLUMN "isTampered" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "AuditLog" ADD COLUMN "anchoredAt" TIMESTAMPTZ;

-- Add indexes for hash-chain fields
CREATE INDEX "idx_audiolog_entryHash" ON "AuditLog"("entryHash");
CREATE INDEX "idx_audiolog_prevHash" ON "AuditLog"("prevHash");
CREATE UNIQUE INDEX "uniq_audiolog_entryHash" ON "AuditLog"("entryHash");

-- Create function to compute SHA-256 hash of JSON data
CREATE OR REPLACE FUNCTION compute_audit_hash(
    id TEXT,
    userId TEXT,
    resource TEXT,
    action TEXT,
    resourceId TEXT,
    payload JSONB,
    httpMethod TEXT,
    requestPath TEXT,
    status TEXT,
    errorMessage TEXT,
    traceId TEXT,
    ipHash TEXT,
    userAgent TEXT,
    geoCountry TEXT,
    createdAt TIMESTAMPTZ,
    prevHash TEXT
) RETURNS TEXT AS $$
DECLARE
    data_str TEXT;
BEGIN
    data_str := jsonb_build_object(
        'id', id,
        'userId', userId,
        'resource', resource,
        'action', action,
        'resourceId', resourceId,
        'payload', payload,
        'httpMethod', httpMethod,
        'requestPath', requestPath,
        'status', status,
        'errorMessage', errorMessage,
        'traceId', traceId,
        'ipHash', ipHash,
        'userAgent', userAgent,
        'geoCountry', geoCountry,
        'createdAt', createdAt::text,
        'prevHash', prevHash
    )::text;
    RETURN encode(digest(data_str, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger function to enforce hash-chain integrity
CREATE OR REPLACE FUNCTION audit_log_hash_chain_trigger()
RETURNS TRIGGER AS $$
DECLARE
    prev_entry RECORD;
    new_hash TEXT;
BEGIN
    -- Get the most recent entry (for prevHash)
    SELECT entryHash INTO prev_entry FROM "AuditLog" ORDER BY "createdAt" DESC, id DESC LIMIT 1;
    
    -- Compute new entry hash
    new_hash := compute_audit_hash(
        NEW.id,
        NEW."userId",
        NEW.resource,
        NEW.action,
        NEW."resourceId",
        NEW.payload,
        NEW."httpMethod",
        NEW."requestPath",
        NEW.status,
        NEW."errorMessage",
        NEW."traceId",
        NEW."ipHash",
        NEW."userAgent",
        NEW."geoCountry",
        NEW."createdAt",
        COALESCE(prev_entry.entryHash, '')
    );
    
    -- Set the hash values
    NEW."prevHash" := prev_entry.entryHash;
    NEW."entryHash" := new_hash;
    
    -- Prevent UPDATE operations on existing entries
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Audit log entries cannot be modified - hash chain integrity would be broken';
    END IF;
    
    -- Prevent DELETE operations
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit log entries cannot be deleted - hash chain integrity would be broken';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger on AuditLog table
DROP TRIGGER IF EXISTS audit_log_hash_chain ON "AuditLog";
CREATE TRIGGER audit_log_hash_chain
    BEFORE INSERT OR UPDATE OR DELETE ON "AuditLog"
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_hash_chain_trigger();

-- Add trigger to prevent manual schema bypass attempts
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Audit log schema modifications are forbidden - hash chain integrity would be compromised';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Audit log entries cannot be deleted - tamper evidence would be lost';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;