-- 0005 added update_creator_reputation(VARCHAR, DECIMAL DEFAULT NULL) next to
-- 0003's update_creator_reputation(VARCHAR). With both present, the reviews
-- trigger's call `update_creator_reputation(NEW.creator_id)` is ambiguous and
-- every INSERT/UPDATE/DELETE on reviews fails with "function ... is not
-- unique". Nothing passes the second argument (the reliability score is not
-- computed in the application layer), so drop the 0005 overload and keep
-- 0003's version, which computes the time-decayed reliability score itself.
DROP FUNCTION IF EXISTS update_creator_reputation(VARCHAR, DECIMAL);
