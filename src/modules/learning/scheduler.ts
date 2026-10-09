import { fsrs, Rating, type Card, type Grade } from 'ts-fsrs';
import { assert } from '../../lib/errors';
const engine=fsrs({enable_fuzz:false});
export function nextSchedule(raw:unknown,rating:'Again'|'Hard'|'Good'|'Easy',now:Date){
  assert(!Number.isNaN(now.getTime()),422,'调度时间无效');
  const value=raw as Card;
  const card:Card={...value,due:new Date(value.due),...(value.last_review?{last_review:new Date(value.last_review)}:{})};
  const result=engine.next(card,now,Rating[rating] as Grade);return result.card;
}
