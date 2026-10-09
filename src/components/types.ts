import type { books,chapters,sources,agents,attempts,artifacts,questions } from '../lib/schema';
export type User={id:string;name:string;email:string;timezone:string};
export type Book=Omit<typeof books.$inferSelect,'storagePath'|'hash'|'coverCipher'|'createdAt'>&{hasCover:boolean;createdAt:string;due:number;cards:number};
export type Chapter=typeof chapters.$inferSelect;
export type Source=typeof sources.$inferSelect;
export type Agent=Omit<typeof agents.$inferSelect,'keyCipher'|'createdAt'>&{hasKey:boolean};
export type Attempt=Omit<typeof attempts.$inferSelect,'createdAt'|'ratedAt'>&{createdAt:string;ratedAt:string|null};
export type Artifact=Omit<typeof artifacts.$inferSelect,'createdAt'>&{createdAt:string};
export type Question=Pick<typeof questions.$inferSelect,'id'|'goal'|'prompt'>&{remedy?:boolean};
export type Review={id:string;bookId:string;questionId:string;title:string;question:Question;dueAt:string;due:boolean;version:number};
export type Job={id:string;bookId:string;kind:string;status:string;total:number;completed:number;errors:{batch:number;message:string}[];coverage:string[];chapterIds:string[];createdAt:string};

export type EnvironmentModel={provider:'deepseek'|'glm';name:string;model:string;isDefault:boolean;source:'environment'};
