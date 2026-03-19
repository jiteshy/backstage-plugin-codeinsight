# Core Prompt: Deployment

**Module ID:** `core/deployment`

**Purpose:** Generate a "Deployment" section documenting how to build, containerise, and deploy the project. Only included when the classifier detects a Dockerfile, CI config, or infrastructure files.

**Used by:** `DocGenerationService` in `@codeinsight/doc-generator`

---

## Required CIG Fields

| Field | Usage |
|-------|-------|
| `files` | Locate Dockerfile, CI workflow files, k8s manifests, docker-compose |
| `detected.frameworks` | Identify framework-specific build steps |
| `detected.language` | Determine build tooling |

## Required File Inputs

| File | Required | Notes |
|------|----------|-------|
| `Dockerfile` | If present | Container build instructions |
| `.github/workflows/*.yml` / `.gitlab-ci.yml` / `Jenkinsfile` | If present | CI/CD pipeline definition |
| `docker-compose.yml` / `docker-compose.prod.yml` | If present | Multi-service orchestration |
| `k8s/*.yaml` / `helm/` | If present | Kubernetes manifests |
| `package.json` build scripts | For Node.js | `build`, `start` commands |

**Token budget:** ~4–8K tokens input / ~600 tokens output

---

## System Prompt

```
You are a technical documentation writer. Generate a "Deployment" section for a software project based on its Dockerfile, CI/CD workflow files, and infrastructure manifests.

Output ONLY a markdown section starting with "## Deployment". Do not include any other headers or preamble.

The section should cover:
1. Build — how to compile/build the project for production
2. Docker — how to build and run the Docker image (if Dockerfile present)
3. CI/CD pipeline — what the pipeline does at each stage (if CI config present)
4. Infrastructure — Kubernetes or docker-compose setup (if manifests present)
5. Environment — which environment variables must be set in production (cross-reference Configuration section)

Rules:
- Use actual stage names, job names, and script commands from the CI config
- Reference actual image names, port numbers, and volume mounts from the Dockerfile
- If multiple deployment targets exist (staging vs production), document both
- Do not invent deployment steps not evidenced in the provided files
- Keep the section factual and operational — someone should be able to deploy from this section
```

---

## User Prompt Template

```
## Dockerfile
```dockerfile
{dockerfileContent}
```

## CI/CD Pipeline ({ciFileName})
```yaml
{ciContent}
```

## Docker Compose ({dockerComposeFileName})
```yaml
{dockerComposeContent}
```

## Kubernetes Manifests
{k8sContent}

## Build Scripts (package.json)
```json
{buildScripts}
```

Generate the Deployment section for this repository.
```

**Template variables:**
- `{dockerfileContent}` — full Dockerfile; omit block if not present
- `{ciFileName}` — e.g., `.github/workflows/deploy.yml`; omit block if not present
- `{ciContent}` — full CI config content, up to 2K tokens; if multiple CI files present, include the most relevant one (prefer deploy/release over test-only workflows)
- `{dockerComposeFileName}` — `docker-compose.yml` or `docker-compose.prod.yml`; omit block if not present
- `{dockerComposeContent}` — full docker-compose content
- `{k8sContent}` — content of k8s manifests, each prefixed with its file path; cap at 2K tokens; omit if not present
- `{buildScripts}` — only the `scripts` object from `package.json`, filtered to build/start keys

---

## Output Format

```markdown
## Deployment

### Building for Production

```bash
pnpm build
```

This compiles TypeScript to `dist/` and bundles assets.

### Docker

**Build the image:**
```bash
docker build -t myapp:latest .
```

**Run the container:**
```bash
docker run -d \
  -p 3000:3000 \
  --env-file .env.production \
  myapp:latest
```

The image exposes port `3000`. The application requires a `DATABASE_URL` environment variable pointing to a PostgreSQL instance.

### CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main`:

1. **test** — Runs `pnpm test` against a PostgreSQL service container
2. **build** — Runs `pnpm build` and builds the Docker image
3. **push** — Pushes the image to GitHub Container Registry (`ghcr.io/org/myapp`)
4. **deploy** — SSHes into the production server and pulls the new image

### Docker Compose (Development)

```bash
docker compose up -d
```

Starts the application and a local PostgreSQL instance. See `docker-compose.yml` for service configuration.

### Kubernetes

Manifests are in `k8s/`. Apply with:

```bash
kubectl apply -f k8s/
```

The deployment uses 2 replicas by default. Configure resource limits in `k8s/deployment.yaml`.
```

---

## Acceptance Criteria

The generated section must:
- Include the exact build command from the manifest scripts
- Reference actual CI stage/job names from the workflow file
- Document the correct Docker image port from the Dockerfile `EXPOSE` directive
- Describe what each CI stage does based on the actual script commands
- Not describe deployment targets not evidenced in the provided files

---

## Token Budget

- Dockerfile: ~400 tokens
- CI config: up to 2,000 tokens
- docker-compose: ~600 tokens
- k8s manifests: up to 1,500 tokens
- Build scripts: ~200 tokens
- System prompt: ~350 tokens
- **Total input:** ~5,000 tokens
- **Expected output:** ~500 tokens
- **Cached:** Yes — same inputs + prompt version → same output
