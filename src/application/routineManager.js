function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJson(raw, relativePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function validateEntity(entity, label) {
  assert(entity && typeof entity === "object", `${label} must be an object`);
  assert(typeof entity.id === "string" && entity.id.trim().length > 0, `${label}.id is required`);
}

export class RoutineManager {
  constructor({ gitRepository }) {
    this.gitRepository = gitRepository;
    this.routinesDir = ".pomblock/routines";
    this.templatesDir = ".pomblock/templates";
    this.policyPath = ".pomblock/policy.json";
  }

  loadRoutines() {
    return this.loadEntities(this.routinesDir);
  }

  saveRoutine(routine) {
    validateEntity(routine, "routine");
    const filePath = `${this.routinesDir}/${routine.id}.json`;
    this.gitRepository.writeFile(filePath, `${JSON.stringify(routine, null, 2)}\n`);
    this.gitRepository.commitAndPush(`save routine: ${routine.id}`, [filePath]);
    return routine;
  }

  loadTemplates() {
    return this.loadEntities(this.templatesDir);
  }

  saveTemplate(template) {
    validateEntity(template, "template");
    const filePath = `${this.templatesDir}/${template.id}.json`;
    this.gitRepository.writeFile(filePath, `${JSON.stringify(template, null, 2)}\n`);
    this.gitRepository.commitAndPush(`save template: ${template.id}`, [filePath]);
    return template;
  }

  savePolicy(policy) {
    assert(policy && typeof policy === "object", "policy must be an object");
    this.gitRepository.writeFile(this.policyPath, `${JSON.stringify(policy, null, 2)}\n`);
    this.gitRepository.commitAndPush("save policy", [this.policyPath]);
    return policy;
  }

  loadPolicy() {
    try {
      const raw = this.gitRepository.readFile(this.policyPath);
      return parseJson(raw, this.policyPath);
    } catch {
      return null;
    }
  }

  syncWithGit() {
    this.gitRepository.pull();
    return {
      routines: this.loadRoutines(),
      templates: this.loadTemplates(),
      policy: this.loadPolicy(),
    };
  }

  loadEntities(relativeDir) {
    const fileNames = this.gitRepository
      .listFiles(relativeDir)
      .filter((fileName) => fileName.endsWith(".json"));
    const entities = [];
    for (const fileName of fileNames) {
      const fullPath = `${relativeDir}/${fileName}`;
      const raw = this.gitRepository.readFile(fullPath);
      entities.push(parseJson(raw, fullPath));
    }
    return entities;
  }
}
