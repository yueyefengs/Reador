-- 关联记录必须属于同一账号和书籍，防止应用层遗漏校验造成跨账号串联。
ALTER TABLE agents ADD CONSTRAINT agents_owner_pair UNIQUE(id,owner_id);
--> statement-breakpoint
ALTER TABLE books ADD CONSTRAINT books_owner_pair UNIQUE(id,owner_id);
--> statement-breakpoint
ALTER TABLE chapters ADD CONSTRAINT chapters_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE sources ADD CONSTRAINT sources_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE review_cards ADD CONSTRAINT cards_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE attempts ADD CONSTRAINT attempts_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_owner_book UNIQUE(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_owner_pair UNIQUE(id,owner_id);
--> statement-breakpoint
ALTER TABLE chapters ADD CONSTRAINT chapters_book_owner_fk FOREIGN KEY(book_id,owner_id) REFERENCES books(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE sources ADD CONSTRAINT sources_chapter_owner_book_fk FOREIGN KEY(chapter_id,owner_id,book_id) REFERENCES chapters(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE progress ADD CONSTRAINT progress_chapter_owner_book_fk FOREIGN KEY(chapter_id,owner_id,book_id) REFERENCES chapters(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE progress ADD CONSTRAINT progress_source_owner_book_fk FOREIGN KEY(source_id,owner_id,book_id) REFERENCES sources(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_book_owner_fk FOREIGN KEY(book_id,owner_id) REFERENCES books(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE jobs ADD CONSTRAINT jobs_agent_owner_fk FOREIGN KEY(agent_id,owner_id) REFERENCES agents(id,owner_id);
--> statement-breakpoint
ALTER TABLE artifacts ADD CONSTRAINT artifacts_job_owner_book_fk FOREIGN KEY(job_id,owner_id,book_id) REFERENCES jobs(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_book_owner_fk FOREIGN KEY(book_id,owner_id) REFERENCES books(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_job_owner_book_fk FOREIGN KEY(job_id,owner_id,book_id) REFERENCES jobs(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE review_cards ADD CONSTRAINT cards_question_owner_book_fk FOREIGN KEY(question_id,owner_id,book_id) REFERENCES questions(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE attempts ADD CONSTRAINT attempts_card_owner_book_fk FOREIGN KEY(card_id,owner_id,book_id) REFERENCES review_cards(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE attempts ADD CONSTRAINT attempts_question_owner_book_fk FOREIGN KEY(question_id,owner_id,book_id) REFERENCES questions(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE questions ADD CONSTRAINT questions_remedy_owner_book_fk FOREIGN KEY(remedy_of,owner_id,book_id) REFERENCES attempts(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE review_logs ADD CONSTRAINT logs_attempt_owner_book_fk FOREIGN KEY(attempt_id,owner_id,book_id) REFERENCES attempts(id,owner_id,book_id);
--> statement-breakpoint
ALTER TABLE review_logs ADD CONSTRAINT logs_card_owner_book_fk FOREIGN KEY(card_id,owner_id,book_id) REFERENCES review_cards(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_book_owner_fk FOREIGN KEY(book_id,owner_id) REFERENCES books(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_chapter_owner_book_fk FOREIGN KEY(chapter_id,owner_id,book_id) REFERENCES chapters(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE conversations ADD CONSTRAINT conversations_source_owner_book_fk FOREIGN KEY(selected_source_id,owner_id,book_id) REFERENCES sources(id,owner_id,book_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE messages ADD CONSTRAINT messages_conversation_owner_fk FOREIGN KEY(conversation_id,owner_id) REFERENCES conversations(id,owner_id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX question_job_batch_unique ON questions(job_id,batch_key) WHERE batch_key IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX question_remedy_unique ON questions(remedy_of) WHERE remedy_of IS NOT NULL;
