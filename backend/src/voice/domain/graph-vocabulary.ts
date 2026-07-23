/**
 * The closed vocabulary of the memory graph.
 *
 * Previously `label` and `type` were free-form strings straight from the LLM.
 * Verified live: the *same* sentence produced `Organization:Acme Corp` on one
 * run and `Company:Acme Corp` on the next, and `WORKS_FOR` vs `EMPLOYEE_OF`.
 * Two names for one thing means the graph cannot self-join — "who works at
 * Acme?" misses half the answers — and no amount of entity resolution fixes it,
 * because the resolution key itself is unstable.
 *
 * These enums are fed to the model as a JSON-schema `enum`, so the constraint is
 * enforced at generation time rather than hoped for in a prompt.
 */
export enum EntityNodeType {
  Person = 'Person',
  Organization = 'Organization',
  Project = 'Project',
  Task = 'Task',
  Event = 'Event',
  Location = 'Location',
  Topic = 'Topic',
  Product = 'Product',
  TimeReference = 'TimeReference',
  Other = 'Other',
}

export enum EntityRelationType {
  WORKS_FOR = 'WORKS_FOR',
  MEMBER_OF = 'MEMBER_OF',
  PARTICIPANT_IN = 'PARTICIPANT_IN',
  ASSIGNED_TO = 'ASSIGNED_TO',
  RESPONSIBLE_FOR = 'RESPONSIBLE_FOR',
  PART_OF = 'PART_OF',
  LOCATED_IN = 'LOCATED_IN',
  SCHEDULED_FOR = 'SCHEDULED_FOR',
  KNOWS = 'KNOWS',
  OWNS = 'OWNS',
  DEPENDS_ON = 'DEPENDS_ON',
  RELATED_TO = 'RELATED_TO',
}

export const ENTITY_NODE_TYPES = Object.values(EntityNodeType);
export const ENTITY_RELATION_TYPES = Object.values(EntityRelationType);

/**
 * The key entity resolution joins on.
 *
 * Case, surrounding punctuation and accents must not create a second "Sarah
 * Okonkwo". Deliberately conservative: it does NOT stem, drop stopwords, or
 * strip titles, because collapsing "Sarah" and "Sarah's team" into one entity
 * silently corrupts memories and is far worse than a duplicate we can merge
 * later.
 */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFKD')
    // Strip combining accents so "José" and "Jose" resolve together.
    // Built from an escaped string rather than a regex literal: the range is
    // raw combining marks, which are invisible in most editors and silently
    // corrupted by a re-encode.
    .replace(new RegExp('[\u0300-\u036f]', 'g'), '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SELF_REFERENCES = new Set([
  'i',
  'me',
  'myself',
  'my',
  'you',
  'yourself',
  'user',
  'the user',
  'speaker',
  'the speaker',
]);

/**
 * Every memory already belongs to exactly one user, so a node for the speaker
 * carries no information and pollutes the graph — the extractor emitted
 * `Person:You` unprompted on a live run. Relations that dangle off it are
 * dropped, which is correct: "You -[MET]-> Sarah" is implicit in the fact that
 * this is your memory.
 */
export function isSelfReference(normalizedName: string): boolean {
  return SELF_REFERENCES.has(normalizedName);
}
