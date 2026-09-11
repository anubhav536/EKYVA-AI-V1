ALTER TABLE "requests" ADD COLUMN "response_json" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "requests_user_id_idempotency_key" ON "requests" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_wallet_idempotency_key" ON "wallet_transactions" USING btree ("wallet_id","idempotency_key");