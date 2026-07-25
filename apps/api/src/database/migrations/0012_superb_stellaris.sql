-- Retain telephony_processed_webhook_events for rolling-deploy compatibility.
-- The immediately preceding application revision still reads and writes this table.
SELECT 1;
