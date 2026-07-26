import {
  ENTITY_NODE_TYPES,
  ENTITY_RELATION_TYPES,
  EntityNodeType,
  EntityRelationType,
  isRelationTypeCompatible,
  isSelfReference,
  normalizeEntityName,
} from './graph-vocabulary';

/**
 * normalizeEntityName is the resolution key for the whole memory graph: two
 * names that normalize the same become one entity, two that don't become two.
 * Both failure directions are damaging — over-merging silently fuses two real
 * people, under-merging fragments one person across their own memories.
 */
describe('normalizeEntityName', () => {
  it('collapses case and surrounding whitespace', () => {
    expect(normalizeEntityName('  Sarah Okonkwo ')).toBe('sarah okonkwo');
    expect(normalizeEntityName('SARAH OKONKWO')).toBe('sarah okonkwo');
  });

  it('collapses internal whitespace runs', () => {
    expect(normalizeEntityName('Sarah    Okonkwo')).toBe('sarah okonkwo');
    expect(normalizeEntityName('Sarah\tOkonkwo')).toBe('sarah okonkwo');
  });

  it('strips accents so "José" and "Jose" are the same person', () => {
    expect(normalizeEntityName('José Ramírez')).toBe('jose ramirez');
    expect(normalizeEntityName('José Ramírez')).toBe(
      normalizeEntityName('Jose Ramirez'),
    );
  });

  it('strips punctuation that carries no identity', () => {
    expect(normalizeEntityName('Acme Corp.')).toBe('acme corp');
    expect(normalizeEntityName('Acme, Corp!')).toBe('acme corp');
    expect(normalizeEntityName("Sarah's")).toBe('sarah s');
  });

  it('keeps digits — "Q3 rollout" is not "Q rollout"', () => {
    expect(normalizeEntityName('Q3 Rollout')).toBe('q3 rollout');
  });

  it('keeps non-latin scripts intact', () => {
    // \p{L} must match Arabic, or every Arabic name normalizes to '' and all of
    // them collide into a single entity.
    expect(normalizeEntityName('يامين')).toBe('يامين');
    expect(normalizeEntityName('北京')).toBe('北京');
  });

  it('does NOT merge distinct entities that merely share a prefix', () => {
    expect(normalizeEntityName('Sarah')).not.toBe(normalizeEntityName('Sarah Okonkwo'));
    expect(normalizeEntityName('pricing page')).not.toBe(
      normalizeEntityName('pricing page completion'),
    );
  });

  it('is idempotent — normalizing twice changes nothing', () => {
    const once = normalizeEntityName('  José   RAMÍREZ, Jr. ');
    expect(normalizeEntityName(once)).toBe(once);
  });

  it('returns empty for input with no identity content', () => {
    // The processor skips these; a node named '' would be meaningless and would
    // collide with every other empty name.
    expect(normalizeEntityName('   ')).toBe('');
    expect(normalizeEntityName('!!!')).toBe('');
  });
});

describe('isSelfReference', () => {
  it.each(['i', 'me', 'myself', 'you', 'the user', 'the speaker'])(
    'drops "%s" — the graph is already the user\'s',
    (name) => {
      expect(isSelfReference(normalizeEntityName(name))).toBe(true);
    },
  );

  it('does not drop real people whose names contain those words', () => {
    expect(isSelfReference(normalizeEntityName('Mei'))).toBe(false);
    expect(isSelfReference(normalizeEntityName('Ian'))).toBe(false);
    expect(isSelfReference(normalizeEntityName('Yousef'))).toBe(false);
  });
});

/**
 * The matrix exists because these exact shapes were observed live: objects
 * KNOWing people, features WORKS_FOR-ing companies. A wrongly-typed edge is a
 * confident false fact, which is worse than an untyped one.
 */
describe('isRelationTypeCompatible', () => {
  it('allows the shapes the relations were named for', () => {
    expect(
      isRelationTypeCompatible(
        EntityRelationType.WORKS_FOR,
        EntityNodeType.Person,
        EntityNodeType.Organization,
      ),
    ).toBe(true);
    expect(
      isRelationTypeCompatible(
        EntityRelationType.KNOWS,
        EntityNodeType.Person,
        EntityNodeType.Person,
      ),
    ).toBe(true);
    expect(
      isRelationTypeCompatible(
        EntityRelationType.LOCATED_IN,
        EntityNodeType.Event,
        EntityNodeType.Location,
      ),
    ).toBe(true);
  });

  it('ASSIGNED_TO runs both directions, but never Person→Person', () => {
    expect(
      isRelationTypeCompatible(
        EntityRelationType.ASSIGNED_TO,
        EntityNodeType.Task,
        EntityNodeType.Person,
      ),
    ).toBe(true);
    expect(
      isRelationTypeCompatible(
        EntityRelationType.ASSIGNED_TO,
        EntityNodeType.Person,
        EntityNodeType.Task,
      ),
    ).toBe(true);
    expect(
      isRelationTypeCompatible(
        EntityRelationType.ASSIGNED_TO,
        EntityNodeType.Person,
        EntityNodeType.Person,
      ),
    ).toBe(false);
  });

  it('rejects the junk shapes observed live — objects acting like people', () => {
    // "Box KNOWS Sarah"
    expect(
      isRelationTypeCompatible(
        EntityRelationType.KNOWS,
        EntityNodeType.Product,
        EntityNodeType.Person,
      ),
    ).toBe(false);
    // "billing integration WORKS_FOR Acme"
    expect(
      isRelationTypeCompatible(
        EntityRelationType.WORKS_FOR,
        EntityNodeType.Task,
        EntityNodeType.Organization,
      ),
    ).toBe(false);
    // "the oven RESPONSIBLE_FOR dinner"
    expect(
      isRelationTypeCompatible(
        EntityRelationType.RESPONSIBLE_FOR,
        EntityNodeType.Product,
        EntityNodeType.Event,
      ),
    ).toBe(false);
  });

  it('RELATED_TO accepts anything — it is the downgrade target', () => {
    for (const source of ENTITY_NODE_TYPES) {
      for (const target of ENTITY_NODE_TYPES) {
        expect(
          isRelationTypeCompatible(EntityRelationType.RELATED_TO, source, target),
        ).toBe(true);
      }
    }
  });

  it('every relation type has at least one legal shape', () => {
    for (const type of ENTITY_RELATION_TYPES) {
      const anyLegal = ENTITY_NODE_TYPES.some((s) =>
        ENTITY_NODE_TYPES.some((t) => isRelationTypeCompatible(type, s, t)),
      );
      expect(anyLegal).toBe(true);
    }
  });
});

describe('vocabulary', () => {
  it('exposes every enum member', () => {
    expect(ENTITY_NODE_TYPES).toContain(EntityNodeType.Person);
    expect(ENTITY_NODE_TYPES.length).toBe(Object.keys(EntityNodeType).length);
    expect(ENTITY_RELATION_TYPES).toContain('WORKS_FOR');
  });

  it('has no duplicates — a duplicate enum value would break the JSON schema', () => {
    expect(new Set(ENTITY_NODE_TYPES).size).toBe(ENTITY_NODE_TYPES.length);
    expect(new Set(ENTITY_RELATION_TYPES).size).toBe(ENTITY_RELATION_TYPES.length);
  });
});
