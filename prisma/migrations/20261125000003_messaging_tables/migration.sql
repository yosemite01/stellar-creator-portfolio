-- E2E messaging tables (server/services/messages.ts).
-- Thread, ThreadMember and Message are in schema.prisma but no migration
-- created threads/thread_members/messages, so every messaging call failed
-- with 'relation does not exist' on a database built from migrations (and
-- 20260624090000_add_messages_fts skipped itself for the same reason).

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_members" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "thread_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "attachment" JSONB,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "read_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB,
    "plain_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "thread_members_user_id_idx" ON "thread_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "thread_members_thread_id_user_id_key" ON "thread_members"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

-- AddForeignKey
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_members" ADD CONSTRAINT "thread_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
