ALTER TABLE "users" ADD COLUMN "primary_currency_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_primary_currency_id_currencies_id_fk" FOREIGN KEY ("primary_currency_id") REFERENCES "public"."currencies"("id") ON DELETE restrict ON UPDATE cascade;
