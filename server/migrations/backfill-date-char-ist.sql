-- Backfill: correct `date_char` to the IST (Asia/Kolkata) calendar date.
--
-- Root cause: some sync paths stored date_char as the UTC date, so leads created
-- 00:00–05:29 IST (= 18:30–23:59 UTC the previous day) were filed under the wrong
-- day. The write paths now derive date_char via utils/istDate.js; this one-time
-- backfill corrects existing rows. Safe + idempotent (re-running changes nothing).
--
-- created_time is timestamptz (a UTC instant). `AT TIME ZONE 'Asia/Kolkata'`
-- converts it to the India-local wall clock, and ::date / to_char gives the IST day.

UPDATE leads
SET date_char  = to_char((created_time AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD'),
    updated_at = now()
WHERE created_time IS NOT NULL
  AND to_char((created_time AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD') <> date_char;
