-- CreateEnum (only if not exists)
DO $$ BEGIN
  CREATE TYPE "Specialization" AS ENUM ('SPEAKING', 'WRITING', 'READING', 'LISTENING');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable: add specializations, ieltsBandScore, rating to Tutor
ALTER TABLE "Tutor" ADD COLUMN IF NOT EXISTS "specializations" "Specialization"[] NOT NULL DEFAULT ARRAY[]::"Specialization"[];
ALTER TABLE "Tutor" ADD COLUMN IF NOT EXISTS "ieltsBandScore" DECIMAL(3,1);
ALTER TABLE "Tutor" ADD COLUMN IF NOT EXISTS "rating" DECIMAL(3,2);
