import type { CIGNode, RepoFile } from '@codeinsight/types';

import { CIGBuilder } from '../CIGBuilder';

import { PrismaExtractor } from './PrismaExtractor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFile = (filePath = 'prisma/schema.prisma'): RepoFile => ({
  repoId: 'repo-1',
  filePath,
  currentSha: 'sha-abc',
  fileType: 'schema',
  language: 'prisma',
  parseStatus: 'pending',
});

function extractNodes(schema: string, filePath?: string): CIGNode[] {
  const extractor = new PrismaExtractor();
  return extractor.extractSymbols(schema, makeFile(filePath), 'repo-1');
}

function buildPrisma(
  files: Array<{ filePath: string; content: string }>,
) {
  const builder = new CIGBuilder();
  builder.registerContentExtractor(new PrismaExtractor());
  return builder.build(
    'repo-1',
    files.map(f => ({
      file: makeFile(f.filePath),
      content: f.content,
    })),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrismaExtractor', () => {
  // -------------------------------------------------------------------------
  // Model extraction
  // -------------------------------------------------------------------------

  describe('model extraction', () => {
    it('extracts a simple model with scalar fields', () => {
      const schema = `
model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(1);

      const user = nodes[0];
      expect(user.symbolName).toBe('User');
      expect(user.symbolType).toBe('schema');
      expect(user.startLine).toBe(2);
      expect(user.endLine).toBe(6);
      expect(user.exported).toBe(true);
      expect(user.nodeId).toBe('repo-1:prisma/schema.prisma:User:schema');

      const meta = user.metadata as Record<string, unknown>;
      expect(meta.prismaType).toBe('model');

      const fields = meta.fields as Array<Record<string, unknown>>;
      expect(fields).toHaveLength(3);
      expect(fields[0]).toEqual(
        expect.objectContaining({ name: 'id', type: 'Int', isId: true, hasDefault: true }),
      );
      expect(fields[1]).toEqual(
        expect.objectContaining({ name: 'email', type: 'String', isUnique: true }),
      );
      expect(fields[2]).toEqual(
        expect.objectContaining({ name: 'name', type: 'String', isOptional: true }),
      );
    });

    it('extracts multiple models', () => {
      const schema = `
model User {
  id   Int    @id
  name String
}

model Post {
  id    Int    @id
  title String
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(2);
      expect(nodes[0].symbolName).toBe('User');
      expect(nodes[1].symbolName).toBe('Post');
    });

    it('extracts array fields', () => {
      const schema = `
model User {
  id    Int    @id
  posts Post[]
}
`;
      const nodes = extractNodes(schema);
      const fields = (nodes[0].metadata as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      const postsField = fields.find(f => f.name === 'posts');
      expect(postsField).toEqual(
        expect.objectContaining({ name: 'posts', type: 'Post', isArray: true }),
      );
    });

    it('extracts fields with @default attribute', () => {
      const schema = `
model Post {
  id        Int      @id @default(autoincrement())
  published Boolean  @default(false)
  createdAt DateTime @default(now())
}
`;
      const nodes = extractNodes(schema);
      const fields = (nodes[0].metadata as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      expect(fields[0].hasDefault).toBe(true);
      expect(fields[1].hasDefault).toBe(true);
      expect(fields[2].hasDefault).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Relation extraction
  // -------------------------------------------------------------------------

  describe('relation extraction', () => {
    it('extracts @relation with fields and references', () => {
      const schema = `
model Post {
  id       Int  @id
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
`;
      const nodes = extractNodes(schema);
      const meta = nodes[0].metadata as Record<string, unknown>;
      const fields = meta.fields as Array<Record<string, unknown>>;
      const authorField = fields.find(f => f.name === 'author');
      expect(authorField).toEqual(
        expect.objectContaining({
          name: 'author',
          type: 'User',
          relationFields: ['authorId'],
          relationReferences: ['id'],
        }),
      );

      const relations = meta.relations as Array<Record<string, unknown>>;
      expect(relations).toHaveLength(1);
      expect(relations[0]).toEqual({
        field: 'author',
        target: 'User',
        relationName: null,
      });
    });

    it('extracts named relations', () => {
      const schema = `
model Post {
  id       Int  @id
  author   User @relation("PostAuthor", fields: [authorId], references: [id])
  authorId Int
}
`;
      const nodes = extractNodes(schema);
      const meta = nodes[0].metadata as Record<string, unknown>;
      const fields = meta.fields as Array<Record<string, unknown>>;
      const authorField = fields.find(f => f.name === 'author');
      expect(authorField).toEqual(
        expect.objectContaining({
          relationName: 'PostAuthor',
          relationFields: ['authorId'],
          relationReferences: ['id'],
        }),
      );
    });

    it('extracts multi-field relations', () => {
      const schema = `
model Post {
  id       Int  @id
  author   User @relation(fields: [orgId, userId], references: [orgId, id])
  orgId    Int
  userId   Int
}
`;
      const nodes = extractNodes(schema);
      const fields = (nodes[0].metadata as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      const authorField = fields.find(f => f.name === 'author');
      expect(authorField).toEqual(
        expect.objectContaining({
          relationFields: ['orgId', 'userId'],
          relationReferences: ['orgId', 'id'],
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Enum extraction
  // -------------------------------------------------------------------------

  describe('enum extraction', () => {
    it('extracts enums with values', () => {
      const schema = `
enum Role {
  ADMIN
  USER
  MODERATOR
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(1);

      const role = nodes[0];
      expect(role.symbolName).toBe('Role');
      expect(role.symbolType).toBe('enum');
      expect(role.nodeId).toBe('repo-1:prisma/schema.prisma:Role:enum');

      const meta = role.metadata as Record<string, unknown>;
      expect(meta.prismaType).toBe('enum');
      expect(meta.values).toEqual(['ADMIN', 'USER', 'MODERATOR']);
    });

    it('ignores comments in enum body', () => {
      const schema = `
enum Status {
  ACTIVE
  // deprecated
  INACTIVE
  PENDING
}
`;
      const nodes = extractNodes(schema);
      const meta = nodes[0].metadata as Record<string, unknown>;
      expect(meta.values).toEqual(['ACTIVE', 'INACTIVE', 'PENDING']);
    });
  });

  // -------------------------------------------------------------------------
  // Composite type extraction
  // -------------------------------------------------------------------------

  describe('type extraction', () => {
    it('extracts composite types', () => {
      const schema = `
type Address {
  street String
  city   String
  zip    String
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(1);

      const addr = nodes[0];
      expect(addr.symbolName).toBe('Address');
      expect(addr.symbolType).toBe('schema');

      const meta = addr.metadata as Record<string, unknown>;
      expect(meta.prismaType).toBe('type');
      const fields = meta.fields as Array<Record<string, unknown>>;
      expect(fields).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('skips @@-level attributes', () => {
      const schema = `
model Post {
  id       Int @id
  authorId Int

  @@index([authorId])
  @@map("posts")
}
`;
      const nodes = extractNodes(schema);
      const fields = (nodes[0].metadata as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      // Only id and authorId — not @@index or @@map
      expect(fields).toHaveLength(2);
    });

    it('handles empty model', () => {
      const schema = `
model Empty {
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(1);
      const meta = nodes[0].metadata as Record<string, unknown>;
      expect(meta.fields).toEqual([]);
    });

    it('skips datasource and generator blocks', () => {
      const schema = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id Int @id
}
`;
      const nodes = extractNodes(schema);
      // Only the User model — datasource and generator are not model/enum/type
      expect(nodes).toHaveLength(1);
      expect(nodes[0].symbolName).toBe('User');
    });

    it('handles schema with mixed models and enums', () => {
      const schema = `
enum Role {
  ADMIN
  USER
}

model User {
  id   Int    @id
  role Role   @default(USER)
}

model Post {
  id    Int    @id
  title String
}

type Meta {
  key   String
  value String
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(4);
      expect(nodes.map(n => n.symbolName)).toEqual(['Role', 'User', 'Post', 'Meta']);
      expect(nodes.map(n => n.symbolType)).toEqual(['enum', 'schema', 'schema', 'schema']);
    });

    it('strips inline comments from field attributes', () => {
      const schema = `
model User {
  id    Int    @id // primary key
  email String // @unique is not real here
  name  String @unique // this is unique
}
`;
      const nodes = extractNodes(schema);
      const fields = (nodes[0].metadata as Record<string, unknown>).fields as Array<Record<string, unknown>>;
      expect(fields[0]).toEqual(expect.objectContaining({ name: 'id', isId: true }));
      // "// @unique" in a comment should NOT trigger isUnique
      expect(fields[1].isUnique).toBeUndefined();
      // Real @unique before the comment should trigger it
      expect(fields[2]).toEqual(expect.objectContaining({ name: 'name', isUnique: true }));
    });

    it('handles comments between blocks', () => {
      const schema = `
// User model
model User {
  id Int @id
}

// Post model
model Post {
  id Int @id
}
`;
      const nodes = extractNodes(schema);
      expect(nodes).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // CIGBuilder integration
  // -------------------------------------------------------------------------

  describe('CIGBuilder integration', () => {
    it('processes .prisma files via registerContentExtractor', () => {
      const schema = `
model User {
  id    Int    @id
  email String @unique
}

enum Role {
  ADMIN
  USER
}
`;
      const result = buildPrisma([
        { filePath: 'prisma/schema.prisma', content: schema },
      ]);

      expect(result.filesProcessed).toBe(1);
      expect(result.filesSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // User model + Role enum + <module> node
      const nonModuleNodes = result.nodes.filter(n => n.symbolName !== '<module>');
      expect(nonModuleNodes).toHaveLength(2);
      expect(nonModuleNodes[0].symbolName).toBe('User');
      expect(nonModuleNodes[1].symbolName).toBe('Role');

      // Module node created
      const moduleNode = result.nodes.find(n => n.symbolName === '<module>');
      expect(moduleNode).toBeDefined();
    });

    it('generates relation edges between models', () => {
      const schema = `
model User {
  id    Int    @id
  posts Post[]
}

model Post {
  id       Int  @id
  author   User @relation(fields: [authorId], references: [id])
  authorId Int
}
`;
      const result = buildPrisma([
        { filePath: 'prisma/schema.prisma', content: schema },
      ]);

      // Post.author → User relation edge
      const edges = result.edges;
      expect(edges).toHaveLength(2); // User.posts→Post + Post.author→User

      const postToUser = edges.find(e =>
        e.fromNodeId.includes('Post') && e.toNodeId.includes('User'),
      );
      expect(postToUser).toBeDefined();
      expect(postToUser!.edgeType).toBe('references');

      const userToPost = edges.find(e =>
        e.fromNodeId.includes('User') && e.toNodeId.includes('Post'),
      );
      expect(userToPost).toBeDefined();
    });

    it('handles self-referential relations', () => {
      const schema = `
model Category {
  id       Int        @id
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  parentId Int?
  children Category[] @relation("CategoryTree")
}
`;
      const result = buildPrisma([
        { filePath: 'prisma/schema.prisma', content: schema },
      ]);

      // Self-referential edges: parent→Category and children→Category
      // Both have a relation name so they should be created
      const selfEdges = result.edges.filter(
        e => e.fromNodeId.includes('Category') && e.toNodeId.includes('Category'),
      );
      expect(selfEdges).toHaveLength(2);
    });

    it('respects file size limit', () => {
      const result = buildPrisma([
        { filePath: 'prisma/schema.prisma', content: 'x'.repeat(2_000_000) },
      ]);
      expect(result.filesSkipped).toBe(1);
      expect(result.filesProcessed).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Realistic schema
  // -------------------------------------------------------------------------

  describe('realistic schema', () => {
    const FULL_SCHEMA = `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  ADMIN
  USER
  MODERATOR
}

enum PostStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  posts     Post[]
  comments  Comment[]
  profile   Profile?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Profile {
  id     Int    @id @default(autoincrement())
  bio    String?
  avatar String?
  user   User   @relation(fields: [userId], references: [id])
  userId Int    @unique
}

model Post {
  id        Int        @id @default(autoincrement())
  title     String
  content   String?
  status    PostStatus @default(DRAFT)
  author    User       @relation(fields: [authorId], references: [id])
  authorId  Int
  comments  Comment[]
  tags      Tag[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@index([authorId])
  @@index([status])
}

model Comment {
  id        Int      @id @default(autoincrement())
  content   String
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  post      Post     @relation(fields: [postId], references: [id])
  postId    Int
  createdAt DateTime @default(now())

  @@index([authorId])
  @@index([postId])
}

model Tag {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}
`;

    it('extracts all models and enums from a full schema', () => {
      const nodes = extractNodes(FULL_SCHEMA);
      const names = nodes.map(n => n.symbolName);
      expect(names).toEqual(['Role', 'PostStatus', 'User', 'Profile', 'Post', 'Comment', 'Tag']);
    });

    it('correctly identifies enums vs schemas', () => {
      const nodes = extractNodes(FULL_SCHEMA);
      const enums = nodes.filter(n => n.symbolType === 'enum');
      const schemas = nodes.filter(n => n.symbolType === 'schema');
      expect(enums.map(n => n.symbolName)).toEqual(['Role', 'PostStatus']);
      expect(schemas.map(n => n.symbolName)).toEqual(['User', 'Profile', 'Post', 'Comment', 'Tag']);
    });

    it('generates correct relation edges in a complex schema', () => {
      const result = buildPrisma([
        { filePath: 'prisma/schema.prisma', content: FULL_SCHEMA },
      ]);

      // Expected relations:
      // User.posts → Post (array), User.comments → Comment, User.profile → Profile
      // Profile.user → User
      // Post.author → User, Post.comments → Comment, Post.tags → Tag
      // Comment.author → User, Comment.post → Post
      // Tag.posts → Post
      expect(result.edges.length).toBeGreaterThanOrEqual(8);

      // Verify specific edges exist
      const edgeDescriptions = result.edges.map(e => {
        const from = e.fromNodeId.split(':')[2];
        const to = e.toNodeId.split(':')[2];
        return `${from}->${to}`;
      });

      expect(edgeDescriptions).toContain('Post->User');
      expect(edgeDescriptions).toContain('Comment->User');
      expect(edgeDescriptions).toContain('Comment->Post');
      expect(edgeDescriptions).toContain('Profile->User');
    });

    it('extracts correct line ranges', () => {
      const nodes = extractNodes(FULL_SCHEMA);
      const user = nodes.find(n => n.symbolName === 'User')!;
      // User model starts at line 21 and ends at line 31
      expect(user.startLine).toBeGreaterThan(0);
      expect(user.endLine).toBeGreaterThan(user.startLine);
    });
  });
});
