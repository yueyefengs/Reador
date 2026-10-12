import { createHash } from 'node:crypto';
import type { Citation,ConceptKind } from '../../lib/schema';
export function normalizeConceptLabel(value:string){return value.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('zh-CN')}
export function conceptIdentity(value:{label:string;kind:ConceptKind;citations:Citation[]}){
  const anchorSourceId=[...new Set(value.citations.map(citation=>citation.sourceId))].sort()[0];
  return {anchorSourceId,identityKey:createHash('sha256').update(JSON.stringify([normalizeConceptLabel(value.label),value.kind,anchorSourceId])).digest('hex')};
}
export function sameConcept(left:{label:string;kind:ConceptKind;citations:Citation[]},right:{label:string;kind:ConceptKind;citations:Citation[]}){
  return normalizeConceptLabel(left.label)===normalizeConceptLabel(right.label)&&left.kind===right.kind&&left.citations.some(a=>right.citations.some(b=>a.sourceId===b.sourceId));
}
