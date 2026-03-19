# Backend Prompt: Database

**Module ID:** `backend/database`

**Purpose:** Generate a "Database" section documenting the data model, schema, relationships between entities, and migration strategy. Included when an ORM or database library is detected.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `schemas` | ORM model definitions (Prisma, SQLAlchemy, TypeORM, Drizzle, etc.) — primary data source |
| `detected.database` | Identify ORM/database technology |
| `files` | Locate migration files |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| Schema definition file (`schema.prisma`, `models.py`, `entities/*.ts`) | Yes | Primary source for table/model structure |
| Migration files (most recent 2-3) | If present | Show schema evolution history |
| DB config / connection file | If present | Database engine and connection setup |

**Token budget:** ~5–8K tokens input / ~700 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Database" section for a backend service based on its ORM schema definitions and migration files.

Output ONLY a markdown section starting with "## Database". Do not include any other headers or preamble.

The section should cover:
1. Database engine and ORM (e.g., PostgreSQL via Prisma, MySQL via SQLAlchemy)
2. Data model — one sub-section per major entity/table, each describing:
   - Fields with types and constraints (required, unique, default)
   - Relationships to other entities (one-to-many, many-to-many, etc.)
3. Entity relationship summary — a brief prose description of how the main entities relate
4. Migration strategy (if migration files present) — how migrations are run

Rules:
- Document every model/table visible in the schema files
- Use the actual field names and types as defined (do not normalise to SQL — use the ORM's type names)
- Represent relationships clearly: "A User has many Posts", "A Post belongs to one User"
- If an entity has more than 15 fields, group them by purpose (identity, timestamps, content, metadata)
- Do not invent relationships not present in the schema
```

---

## User Prompt Template

```
## ORM: {orm}
## Database: {database}

## Schema Definition ({schemaFileName})
```
{schemaContent}
```

## Recent Migrations
{migrationsContent}

Generate the Database section for this repository.
```

**Template variables:**
- `{orm}` — from CIG `detected.database` (e.g., `prisma`, `typeorm`, `sqlalchemy`, `drizzle`)
- `{database}` — inferred from schema or config (e.g., `PostgreSQL`, `MySQL`, `SQLite`)
- `{schemaFileName}` — e.g., `prisma/schema.prisma`, `src/models/index.ts`
- `{schemaContent}` — full schema file content, up to 4K tokens
- `{migrationsContent}` — content of the 2 most recent migration files, each prefixed with its file path; cap at 1.5K tokens total; omit if no migration files found

---

## Output Format

```markdown
## Database

**Engine:** PostgreSQL 14+
**ORM:** Prisma 5

### Data Model

#### `User`

Represents an authenticated user account.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `String` | Primary key, UUID | Unique user identifier |
| `email` | `String` | Unique, required | User's email address |
| `passwordHash` | `String` | Required | Bcrypt-hashed password |
| `createdAt` | `DateTime` | Default: now() | Account creation timestamp |
| `updatedAt` | `DateTime` | Auto-updated | Last modification timestamp |

**Relationships:**
- Has many `Post` records (one-to-many via `Post.authorId`)
- Has many `Session` records (one-to-many via `Session.userId`)

---

#### `Post`

A published or draft article authored by a User.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | `String` | Primary key, UUID | Unique post identifier |
| `title` | `String` | Required | Post title |
| `content` | `String` | Required | Markdown body |
| `published` | `Boolean` | Default: false | Publication status |
| `authorId` | `String` | Required, FK → User | Author reference |

**Relationships:**
- Belongs to one `User` (many-to-one via `authorId`)
- Has many `Tag` records (many-to-many via `_PostToTag`)

### Entity Relationships

Users author Posts. Posts are tagged with Tags via a join table. Each User can have multiple active Sessions for token management.

### Migrations

Migrations are managed with Prisma Migrate. Run migrations with:

```bash
pnpm db:migrate
```

New migrations are generated with `prisma migrate dev --name <description>`.
```

---

## Acceptance Criteria

The generated section must:
- Document every model/table in the schema file
- Use exact field names and ORM type names
- Correctly describe relationships (direction and cardinality)
- Include the migration command if migrations are present
- Not invent fields or relationships not in the schema

---

## Token Budget

- Schema file: up to 4,000 tokens
- Migration files: up to 1,500 tokens
- System prompt: ~350 tokens
- **Total input:** ~6,000 tokens
- **Expected output:** ~600 tokens
- **Cached:** Yes — same inputs + prompt version → same output
