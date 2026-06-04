-- Opt-in adaptive learning flag (default OFF → no behaviour change for existing bots).
-- AlterTable
ALTER TABLE "bot_configs" ADD COLUMN "useAdaptiveLearning" BOOLEAN NOT NULL DEFAULT false;
