-- 同一知识目标同一调度轮次只允许一次正式作答；讲解后的再测独立保存。
CREATE UNIQUE INDEX formal_attempt_round_unique ON attempts(card_id,schedule_version) WHERE kind <> 'remedy';
