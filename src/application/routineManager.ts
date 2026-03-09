type JsonEntity = {
  id: string;
  [key: string]: unknown;
};

type JsonObject = Record<string, unknown>;

type GitRepositoryPort = {
  readFile(relativePath: string): string;
  writeFile(relativePath: string, content: string): void;
  listFiles(relativeDir: string): string[];
  pull(): void;
  commitAndPush(message: string, files: string[]): void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJson(raw: string, relativePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid JSON in ${relativePath}: ${message}`);
  }
}

function validateEntity(entity: unknown, label: string): asserts entity is JsonEntity {
  assert(entity && typeof entity === "object", `${label} must be an object`);
  assert(
    typeof (entity as { id?: unknown }).id === "string" && (entity as { id: string }).id.trim().length > 0,
    `${label}.id is required`
  );
}

export class RoutineManager {
  private readonly gitRepository: GitRepositoryPort;
  private readonly routinesDir: string;
  private readonly templatesDir: string;
  private readonly policyPath: string;

  constructor({ gitRepository }: { gitRepository: GitRepositoryPort }) {
    this.gitRepository = gitRepository;
    this.routinesDir = ".pomblock/routines";
    this.templatesDir = ".pomblock/templates";
    this.policyPath = ".pomblock/policy.json";
  }

  loadRoutines<T extends JsonEntity = JsonEntity>(): T[] {
    return this.loadEntities<T>(this.routinesDir);
  }

  saveRoutine<T extends JsonEntity>(routine: T): T {
    validateEntity(routine, "routine");
    const filePath = `${this.routinesDir}/${routine.id}.json`;
    this.gitRepository.writeFile(filePath, `${JSON.stringify(routine, null, 2)}\n`);
    this.gitRepository.commitAndPush(`save routine: ${routine.id}`, [filePath]);
    return routine;
  }

  loadTemplates<T extends JsonEntity = JsonEntity>(): T[] {
    return this.loadEntities<T>(this.templatesDir);
  }

  saveTemplate<T extends JsonEntity>(template: T): T {
    validateEntity(template, "template");
    const filePath = `${this.templatesDir}/${template.id}.json`;
    this.gitRepository.writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`);
    this.gitRepository.commitAndPush(`save template: ${template.id}`, [filePath]);
    return template;
  }

  savePolicy<T extends JsonObject>(policy: T): T {
    assert(policy && typeof policy === "object", "policy must be an object");
    this.gitRepository.writeFile(this.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    this.gitRepository.commitAndPush("save policy", [this.policyPath]);
    return policy;
  }

  loadPolicy<T extends JsonObject = JsonObject>(): T | null {
    try {
      const raw = this.gitRepository.readFile(this.policyPath);
      const parsed = parseJson(raw, this.policyPath);
      return parsed && typeof parsed === "object" ? (parsed as T) : null;
    } catch {
      return null;
    }
  }

  syncWithGit(): {
    routines: JsonEntity[];
    templates: JsonEntity[];
    policy: JsonObject | null;
  } {
    this.gitRepository.pull();
    return {
      routines: this.loadRoutines(),
      templates: this.loadTemplates(),
      policy: this.loadPolicy(),
    };
  }

  private loadEntities<T extends JsonEntity = JsonEntity>(relativeDir: string): T[] {
    const fileNames = this.gitRepository
      .listFiles(relativeDir)
      .filter((fileName) => fileName.endsWith(".json"));
    const entities: T[] = [];
    for (const fileName of fileNames) {
      const fullPath = `${relativeDir}/${fileName}`;
      const raw = this.gitRepository.readFile(fullPath);
      const parsed = parseJson(raw, fullPath);
      if (parsed && typeof parsed === "object") {
        entities.push(parsed as T);
      }
    }
    return entities;
  }
}
// Legacy reference implementation during the Rust backend migration.
// Production routine/template/policy backend behavior is moving to `src-tauri/`.
