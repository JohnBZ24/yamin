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

const setOf = (...types: EntityNodeType[]) => new Set(types);
const allExcept = (...types: EntityNodeType[]) =>
  new Set(ENTITY_NODE_TYPES.filter((t) => !types.includes(t)));

type EndpointRule = {
  source: ReadonlySet<EntityNodeType>;
  target: ReadonlySet<EntityNodeType>;
};

const {
  Person,
  Organization,
  Project,
  Task,
  Event,
  Location,
  Topic,
  Product,
  TimeReference,
  Other,
} = EntityNodeType;

/**
 * Which node types each relation type may connect. Verified live: the
 * extractor emitted things like `Product:Box -KNOWS-> Person:Sarah` and
 * `WORKS_FOR` edges hanging off a feature — a typed edge on the wrong node
 * kinds is worse than no edge, because it reads as a confident false fact
 * ("box knows Sarah").
 *
 * The schema enum constrains WHAT types exist; this matrix constrains WHICH
 * may meet. It's enforced deterministically in the processor (incompatible
 * edges are downgraded to RELATED_TO, never dropped) because prompt rules
 * alone demonstrably don't hold at the tail.
 *
 * Each entry is a list of allowed (source-set, target-set) pairs — a list,
 * because e.g. ASSIGNED_TO legitimately runs both Person→Task and
 * Task→Person and a single pair can't say that without also allowing
 * Person→Person.
 */
export const RELATION_TYPE_CONSTRAINTS: Record<EntityRelationType, EndpointRule[]> = {
  [EntityRelationType.WORKS_FOR]: [
    { source: setOf(Person), target: setOf(Organization, Person, Project) },
  ],
  [EntityRelationType.MEMBER_OF]: [
    { source: setOf(Person), target: setOf(Organization, Project, Event, Topic) },
    { source: setOf(Organization), target: setOf(Organization) },
  ],
  [EntityRelationType.PARTICIPANT_IN]: [
    { source: setOf(Person, Organization), target: setOf(Event, Project, Task, Topic) },
  ],
  [EntityRelationType.ASSIGNED_TO]: [
    { source: setOf(Task, Project, Other), target: setOf(Person, Organization) },
    { source: setOf(Person, Organization), target: setOf(Task, Project, Other) },
  ],
  [EntityRelationType.RESPONSIBLE_FOR]: [
    {
      source: setOf(Person, Organization),
      target: setOf(Task, Project, Product, Event, Topic, Organization, Other),
    },
  ],
  [EntityRelationType.PART_OF]: [
    {
      source: allExcept(TimeReference),
      target: setOf(Organization, Project, Product, Topic, Event, Location, Other),
    },
  ],
  [EntityRelationType.LOCATED_IN]: [
    { source: allExcept(TimeReference), target: setOf(Location, Organization, Event, Other) },
  ],
  [EntityRelationType.SCHEDULED_FOR]: [
    { source: setOf(Event, Task, Project, Other), target: setOf(TimeReference, Event) },
  ],
  [EntityRelationType.KNOWS]: [{ source: setOf(Person), target: setOf(Person) }],
  [EntityRelationType.OWNS]: [
    {
      source: setOf(Person, Organization),
      target: setOf(Product, Project, Organization, Location, Task, Topic, Other),
    },
  ],
  [EntityRelationType.DEPENDS_ON]: [
    { source: allExcept(TimeReference), target: allExcept(TimeReference) },
  ],
  // The untyped fallback — anything may relate to anything.
  [EntityRelationType.RELATED_TO]: [
    { source: allExcept(), target: allExcept() },
  ],
};

/** Can this relation type legally connect these two node types? */
export function isRelationTypeCompatible(
  type: EntityRelationType,
  sourceType: EntityNodeType,
  targetType: EntityNodeType,
): boolean {
  return RELATION_TYPE_CONSTRAINTS[type].some(
    (rule) => rule.source.has(sourceType) && rule.target.has(targetType),
  );
}

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
