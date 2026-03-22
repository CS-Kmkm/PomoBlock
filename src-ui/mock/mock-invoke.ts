import type { Block, JsonObject, MockState, Module, Recipe } from "../types.js";

type MockInvokeDeps = {
    mockState: MockState;
    nextMockId: (prefix: string) => string;
    ensureMockRecipesSeeded: () => void;
    ensureMockModulesSeeded: () => void;
    normalizeAccountId: (value: unknown) => string;
    nowIso: () => string;
    isoDate: (value: Date) => string;
    emptyMockPomodoroState: () => MockState["pomodoro"];
    mockSessionPlan: (block: Block) => { totalCycles: number; focusSeconds: number; breakSeconds: number; };
    appendMockPomodoroLog: (phase: string, interruptionReason?: string | null) => void;
    unassignMockTask: (taskId: string) => void;
    assignMockTask: (taskId: string, blockId: string) => void;
    toRecord: (value: unknown) => Record<string, unknown>;
    readString: (payload: Record<string, unknown>, key: string, fallback?: string) => string;
    readStringArray: (payload: Record<string, unknown>, key: string) => string[];
    readNestedPayload: (payload: Record<string, unknown>) => Record<string, unknown>;
    toJsonObject: (value: unknown) => JsonObject | null;
};

export function createMockInvoke(deps: MockInvokeDeps) {
    const {
        mockState,
        nextMockId,
        ensureMockRecipesSeeded,
        ensureMockModulesSeeded,
        normalizeAccountId,
        nowIso,
        isoDate,
        emptyMockPomodoroState,
        mockSessionPlan,
        appendMockPomodoroLog,
        unassignMockTask,
        assignMockTask,
        toRecord,
        readString,
        readStringArray,
        readNestedPayload,
        toJsonObject,
    } = deps;

    const ensureMockModuleFolders = () => {
        ensureMockModulesSeeded();
        const seen = new Set<string>();
        const folders: Array<{ id: string; name: string }> = [];
        (Array.isArray(mockState.moduleFolders) ? mockState.moduleFolders : []).forEach((folder) => {
            const id = String(folder?.id || folder?.name || "").trim();
            if (!id || seen.has(id)) {
                return;
            }
            seen.add(id);
            folders.push({
                id,
                name: String(folder?.name || id).trim() || id,
            });
        });
        mockState.modules.forEach((module) => {
            const category = String(module.category || "").trim();
            if (!category || seen.has(category)) {
                return;
            }
            seen.add(category);
            folders.push({
                id: category,
                name: category,
            });
        });
        mockState.moduleFolders = folders;
        return folders;
    };

    const routineIdFromValue = (value: unknown) => {
        const routine = toJsonObject(value);
        return String(routine?.id || routine?.routineId || routine?.routine_id || "").trim();
    };

    const ensureMockRoutines = () => {
        mockState.routines = Array.isArray(mockState.routines) ? mockState.routines.map((routine) => ({ ...routine })) : [];
        return mockState.routines;
    };

    const moveMockModule = (args: Record<string, unknown>) => {
        ensureMockModulesSeeded();
        const moduleId = readString(args, "module_id").trim();
        const folderId = readString(args, "folder_id").trim();
        const beforeModuleId = readString(args, "before_module_id").trim();
        if (!moduleId) {
            throw new Error("module_id is required");
        }
        if (!folderId) {
            throw new Error("folder_id is required");
        }
        let folders = ensureMockModuleFolders();
        if (!folders.some((folder) => folder.id === folderId)) {
            mockState.moduleFolders.push({ id: folderId, name: folderId });
            folders = ensureMockModuleFolders();
        }
        const sourceIndex = mockState.modules.findIndex((module) => module.id === moduleId);
        if (sourceIndex < 0) {
            throw new Error("module not found");
        }
        const [moved] = mockState.modules.splice(sourceIndex, 1);
        if (!moved) {
            throw new Error("module not found");
        }
        moved.category = folderId;
        let insertIndex = -1;
        if (beforeModuleId) {
            insertIndex = mockState.modules.findIndex((module) => module.id === beforeModuleId);
            if (insertIndex < 0) {
                throw new Error("before module not found");
            }
            if (String(mockState.modules[insertIndex]?.category || "") !== folderId) {
                throw new Error("before module is not in target folder");
            }
        }
        else {
            for (let index = mockState.modules.length - 1; index >= 0; index -= 1) {
                if (String(mockState.modules[index]?.category || "") === folderId) {
                    insertIndex = index + 1;
                    break;
                }
            }
            if (insertIndex < 0) {
                const targetFolderIndex = folders.findIndex((folder) => folder.id === folderId);
                insertIndex = mockState.modules.length;
                for (let folderIndex = targetFolderIndex + 1; folderIndex < folders.length; folderIndex += 1) {
                    const nextFolderId = folders[folderIndex]?.id;
                    if (!nextFolderId) {
                        continue;
                    }
                    const nextIndex = mockState.modules.findIndex((module) => String(module.category || "") === nextFolderId);
                    if (nextIndex >= 0) {
                        insertIndex = nextIndex;
                        break;
                    }
                }
            }
        }
        mockState.modules.splice(insertIndex, 0, moved);
        return mockState.modules.map((module) => ({ ...module }));
    };

    const mockInvoke = async (name: string, payload: Record<string, unknown>) => {
        const args = toRecord(payload);
        switch (name) {
            case "bootstrap":
                return { workspace_root: "mock", database_path: "mock.sqlite" };
            case "authenticate_google": {
                const accountId = normalizeAccountId(args.account_id);
                return {
                    account_id: accountId,
                    status: args.authorization_code ? "authenticated" : "reauthentication_required",
                    authorization_url: "https://accounts.google.com/o/oauth2/v2/auth",
                    expires_at: new Date(Date.now() + 3600000).toISOString(),
                };
            }
            case "authenticate_google_sso": {
                throw new Error("Google SSO is unavailable in mock mode. Run the desktop app with `cargo tauri dev`.");
            }
            case "sync_calendar": {
            const accountId = normalizeAccountId(args.account_id);
            const seed = typeof args.time_min === "string" ? args.time_min : nowIso();
            const parsed = new Date(seed);
            const dayStart = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
            dayStart.setHours(0, 0, 0, 0);
            const morningStart = new Date(dayStart.getTime() + 10 * 60 * 60 * 1000);
            const morningEnd = new Date(morningStart.getTime() + 30 * 60 * 1000);
            const afternoonStart = new Date(dayStart.getTime() + 14 * 60 * 60 * 1000);
            const afternoonEnd = new Date(afternoonStart.getTime() + 60 * 60 * 1000);
            mockState.syncedEventsByAccount[accountId] = [
                {
                    account_id: accountId,
                    id: nextMockId("evt"),
                    title: "Mock Event A",
                    start_at: morningStart.toISOString(),
                    end_at: morningEnd.toISOString(),
                },
                {
                    account_id: accountId,
                    id: nextMockId("evt"),
                    title: "Mock Event B",
                    start_at: afternoonStart.toISOString(),
                    end_at: afternoonEnd.toISOString(),
                },
            ];
            return {
                account_id: accountId,
                added: mockState.syncedEventsByAccount[accountId].length,
                updated: 0,
                deleted: 0,
                next_sync_token: "mock-token",
                calendar_id: "primary",
            };
        }
        case "list_recipes":
            ensureMockRecipesSeeded();
            return [...mockState.recipes];
        case "create_recipe": {
            ensureMockRecipesSeeded();
            const payloadRecipe = readNestedPayload(args);
            if (!payloadRecipe?.id) {
                throw new Error("recipe id is required");
            }
            if (mockState.recipes.some((recipe) => recipe.id === payloadRecipe.id)) {
                throw new Error("recipe already exists");
            }
            const recipe: Recipe = {
                id: String(payloadRecipe.id),
                name: String(payloadRecipe.name || payloadRecipe.id),
                auto_drive_mode: String(payloadRecipe.autoDriveMode || payloadRecipe.auto_drive_mode || "manual"),
                steps: Array.isArray(payloadRecipe.steps) ? payloadRecipe.steps : [],
            };
            const studioMeta = toJsonObject(payloadRecipe.studioMeta || payloadRecipe.studio_meta || null);
            if (studioMeta) {
                recipe.studioMeta = studioMeta;
            }
            mockState.recipes.push(recipe);
            return recipe;
        }
        case "update_recipe": {
            ensureMockRecipesSeeded();
            const payloadRecipe = readNestedPayload(args);
            const recipeId = readString(args, "recipe_id").trim();
            if (!recipeId)
                throw new Error("recipe_id is required");
            const index = mockState.recipes.findIndex((recipe) => recipe.id === recipeId);
            if (index < 0)
                throw new Error("recipe not found");
            const baseRecipe = mockState.recipes[index]!;
            const updated: Recipe = {
                ...baseRecipe,
                id: recipeId,
                name: baseRecipe.name,
                steps: baseRecipe.steps,
            };
            if (typeof payloadRecipe.name === "string") {
                updated.name = payloadRecipe.name;
            }
            if (typeof payloadRecipe.auto_drive_mode === "string") {
                updated.auto_drive_mode = payloadRecipe.auto_drive_mode;
            }
            else if (typeof payloadRecipe.autoDriveMode === "string") {
                updated.auto_drive_mode = payloadRecipe.autoDriveMode;
            }
            if (Array.isArray(payloadRecipe.steps)) {
                updated.steps = payloadRecipe.steps as Recipe["steps"];
            }
            const studioMeta = toJsonObject(payloadRecipe.studioMeta || payloadRecipe.studio_meta || null);
            if (studioMeta) {
                updated.studioMeta = studioMeta;
            }
            mockState.recipes[index] = updated;
            return updated;
        }
        case "delete_recipe": {
            ensureMockRecipesSeeded();
            const recipeId = readString(args, "recipe_id").trim();
            const before = mockState.recipes.length;
            mockState.recipes = mockState.recipes.filter((recipe) => recipe.id !== recipeId);
            return before !== mockState.recipes.length;
        }
        case "list_routines":
        case "list_routine_schedules":
            return ensureMockRoutines().map((routine) => ({ ...routine }));
        case "save_routine_schedule": {
            const payloadRoutine = readNestedPayload(args);
            const routineId = String(payloadRoutine.id || payloadRoutine.routineId || payloadRoutine.routine_id || "").trim();
            if (!routineId) {
                throw new Error("routine id is required");
            }
            const updated = {
                ...payloadRoutine,
                id: routineId,
            };
            const routines = ensureMockRoutines();
            const index = routines.findIndex((routine) => routineIdFromValue(routine) === routineId);
            if (index >= 0) {
                routines[index] = updated;
            } else {
                routines.push(updated);
            }
            mockState.routines = routines;
            return { ...updated };
        }
        case "save_routine_schedule_group": {
            const payloadGroup = readNestedPayload(args);
            const groupId = String(payloadGroup.group_id || payloadGroup.groupId || "").trim();
            const routines = Array.isArray(payloadGroup.routines) ? payloadGroup.routines : [];
            if (groupId) {
                mockState.routines = ensureMockRoutines().filter((routine) => String(routine?.scheduleGroupId || routine?.schedule_group_id || "") !== groupId);
            }
            const saved: Array<Record<string, unknown>> = [];
            for (const routineValue of routines) {
                const payloadRoutine = toJsonObject(routineValue) || {};
                const routineId = String(payloadRoutine.id || payloadRoutine.routineId || payloadRoutine.routine_id || "").trim();
                if (!routineId) {
                    continue;
                }
                const updated = {
                    ...payloadRoutine,
                    id: routineId,
                    ...(groupId ? { scheduleGroupId: groupId } : {}),
                };
                const routinesState = ensureMockRoutines();
                const index = routinesState.findIndex((routine) => routineIdFromValue(routine) === routineId);
                if (index >= 0) {
                    routinesState[index] = updated;
                } else {
                    routinesState.push(updated);
                }
                saved.push({ ...updated });
            }
            mockState.routines = ensureMockRoutines();
            return saved;
        }
        case "delete_routine_schedule": {
            const routineId = readString(args, "routine_id").trim();
            const before = ensureMockRoutines().length;
            mockState.routines = mockState.routines.filter((routine) => routineIdFromValue(routine) !== routineId);
            return before !== mockState.routines.length;
        }
        case "list_modules":
            ensureMockModulesSeeded();
            return [...mockState.modules];
        case "list_module_folders":
            return ensureMockModuleFolders().map((folder) => ({ ...folder }));
        case "create_module": {
            ensureMockModulesSeeded();
            const payloadModule = readNestedPayload(args);
            if (!payloadModule?.id) {
                throw new Error("module id is required");
            }
            const id = String(payloadModule.id);
            if (mockState.modules.some((module) => module.id === id)) {
                throw new Error("module already exists");
            }
            const created = {
                id,
                name: String(payloadModule.name || id),
                category: String(payloadModule.category || "(default)"),
                description: payloadModule.description ? String(payloadModule.description) : "",
                icon: payloadModule.icon ? String(payloadModule.icon) : "module",
                stepType: String(payloadModule.stepType || payloadModule.step_type || "micro"),
                durationMinutes: Math.max(1, Number(payloadModule.durationMinutes || payloadModule.duration_minutes || 1)),
                checklist: Array.isArray(payloadModule.checklist) ? payloadModule.checklist.map(String).filter(Boolean) : [],
                pomodoro: payloadModule.pomodoro ? { ...payloadModule.pomodoro } : null,
                overrunPolicy: String(payloadModule.overrunPolicy || payloadModule.overrun_policy || "wait"),
                executionHints: payloadModule.executionHints
                    ? { ...payloadModule.executionHints }
                    : { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true },
            };
            mockState.modules.push(created);
            if (!mockState.moduleFolders.some((folder) => folder.id === created.category)) {
                mockState.moduleFolders.push({
                    id: created.category,
                    name: created.category,
                });
            }
            return created;
        }
        case "update_module": {
            ensureMockModulesSeeded();
            const moduleId = readString(args, "module_id").trim();
            if (!moduleId)
                throw new Error("module_id is required");
            const payloadModule = readNestedPayload(args);
            const index = mockState.modules.findIndex((module) => module.id === moduleId);
            if (index < 0)
                throw new Error("module not found");
            const baseModule = mockState.modules[index]!;
            const updated: Module = {
                ...baseModule,
                id: moduleId,
                name: baseModule.name,
            };
            if (typeof payloadModule.name === "string") {
                updated.name = payloadModule.name;
            }
            if (typeof payloadModule.category === "string") {
                updated.category = payloadModule.category;
            }
            if (typeof payloadModule.description === "string") {
                updated.description = payloadModule.description;
            }
            if (typeof payloadModule.icon === "string") {
                updated.icon = payloadModule.icon;
            }
            if (typeof payloadModule.stepType === "string") {
                updated.stepType = payloadModule.stepType;
            }
            else if (typeof payloadModule.step_type === "string") {
                updated.stepType = payloadModule.step_type;
            }
            if (Array.isArray(payloadModule.checklist)) {
                updated.checklist = payloadModule.checklist.map(String).filter(Boolean);
            }
            if (payloadModule.pomodoro === null) {
                updated.pomodoro = null;
            }
            else if (toJsonObject(payloadModule.pomodoro)) {
                updated.pomodoro = { ...toJsonObject(payloadModule.pomodoro) };
            }
            if (typeof payloadModule.overrunPolicy === "string") {
                updated.overrunPolicy = payloadModule.overrunPolicy;
            }
            else if (typeof payloadModule.overrun_policy === "string") {
                updated.overrunPolicy = payloadModule.overrun_policy;
            }
            if (payloadModule.executionHints === null) {
                updated.executionHints = null;
            }
            else if (toJsonObject(payloadModule.executionHints)) {
                updated.executionHints = { ...toJsonObject(payloadModule.executionHints) };
            }
            const durationMinutesSnake = payloadModule["duration_minutes"];
            const rawDuration = payloadModule.durationMinutes ?? durationMinutesSnake ?? updated.durationMinutes ?? 1;
            updated.durationMinutes = Math.max(1, Number(rawDuration));
            updated.checklist = Array.isArray(updated.checklist) ? updated.checklist.map(String).filter(Boolean) : [];
            updated.pomodoro = updated.pomodoro ? { ...updated.pomodoro } : null;
            updated.executionHints = updated.executionHints
                ? { ...updated.executionHints }
                : { allowSkip: true, mustCompleteChecklist: false, autoAdvance: true };
            mockState.modules[index] = updated;
            if (!mockState.moduleFolders.some((folder) => folder.id === String(updated.category || ""))) {
                mockState.moduleFolders.push({
                    id: String(updated.category || ""),
                    name: String(updated.category || ""),
                });
            }
            return updated;
        }
        case "move_module": {
            return moveMockModule(args);
        }
        case "delete_module": {
            ensureMockModulesSeeded();
            const moduleId = readString(args, "module_id").trim();
            const before = mockState.modules.length;
            mockState.modules = mockState.modules.filter((module) => module.id !== moduleId);
            return before !== mockState.modules.length;
        }
        case "create_module_folder": {
            const folders = ensureMockModuleFolders();
            const name = readString(args, "name").trim();
            if (!name) {
                throw new Error("folder name is required");
            }
            if (folders.some((folder) => folder.id.toLowerCase() === name.toLowerCase())) {
                throw new Error("folder already exists");
            }
            const created = { id: name, name };
            mockState.moduleFolders.push(created);
            return created;
        }
        case "delete_module_folder": {
            const folders = ensureMockModuleFolders();
            const folderId = readString(args, "folder_id").trim();
            if (folderId === "(default)") {
                throw new Error("default folder cannot be deleted");
            }
            const before = folders.length;
            mockState.moduleFolders = folders.filter((folder) => folder.id !== folderId);
            if (mockState.moduleFolders.length === before) {
                return false;
            }
            mockState.modules = mockState.modules.filter((module) => String(module.category || "") !== folderId);
            return true;
        }
        case "move_module_folder": {
            const folders = ensureMockModuleFolders();
            const folderId = readString(args, "folder_id").trim();
            const direction = readString(args, "direction").trim().toLowerCase();
            const index = folders.findIndex((folder) => folder.id === folderId);
            if (index < 0) {
                throw new Error("folder not found");
            }
            const nextIndex = direction === "up" ? Math.max(0, index - 1) : Math.min(folders.length - 1, index + 1);
            if (nextIndex !== index) {
                const currentFolder = folders[index];
                const nextFolder = folders[nextIndex];
                if (!currentFolder || !nextFolder) {
                    throw new Error("folder move out of range");
                }
                folders[index] = nextFolder;
                folders[nextIndex] = currentFolder;
            }
            mockState.moduleFolders = folders.map((folder) => ({ ...folder }));
            return mockState.moduleFolders.map((folder) => ({ ...folder }));
        }
        case "apply_studio_template_to_today": {
            ensureMockRecipesSeeded();
            const templateId = readString(args, "template_id").trim();
            const date = readString(args, "date", isoDate(new Date()));
            const triggerTime = readString(args, "trigger_time", "09:00");
            const recipe = mockState.recipes.find((entry) => entry.id === templateId);
            if (!recipe)
                throw new Error("template not found");
            const meta = (recipe.studioMeta || recipe.studio_meta || null) as Record<string, unknown> | null;
            if (!meta || Number(meta.version) !== 1 || String(meta.kind || "").toLowerCase() !== "routine_studio") {
                throw new Error("template is not a routine studio template");
            }
            const totalSeconds = (Array.isArray(recipe.steps) ? recipe.steps : []).reduce((sum, step) => sum + Math.max(60, Number((step as Record<string, unknown>)?.durationSeconds || (step as Record<string, unknown>)?.duration_seconds || 0)), 0);
            if (totalSeconds <= 0)
                throw new Error("template has no duration");
            const [hhRaw, mmRaw] = triggerTime.split(":").map((entry) => Number(entry || 0));
            const hh = Number.isFinite(hhRaw) ? Number(hhRaw) : 9;
            const mm = Number.isFinite(mmRaw) ? Number(mmRaw) : 0;
            const requestedStart = new Date(`${date}T00:00:00`);
            requestedStart.setHours(hh, mm, 0, 0);
            const requestedEnd = new Date(requestedStart.getTime() + totalSeconds * 1000);
            const busyIntervals: Array<{ startMs: number; endMs: number }> = [];
            mockState.blocks
                .filter((block) => block.date === date)
                .forEach((block) => {
                busyIntervals.push({
                    startMs: new Date(block.start_at).getTime(),
                    endMs: new Date(block.end_at).getTime(),
                });
            });
            Object.values(mockState.syncedEventsByAccount)
                .flat()
                .forEach((event) => {
                busyIntervals.push({
                    startMs: new Date(event.start_at).getTime(),
                    endMs: new Date(event.end_at).getTime(),
                });
            });
            const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => leftStart < rightEnd && rightStart < leftEnd;
            const requestedStartMs = requestedStart.getTime();
            const requestedEndMs = requestedEnd.getTime();
            const conflictCount = busyIntervals.filter((interval) => overlaps(requestedStartMs, requestedEndMs, interval.startMs, interval.endMs)).length;
            let appliedStartMs = requestedStartMs;
            let appliedEndMs = requestedEndMs;
            let shifted = false;
            if (conflictCount > 0) {
                const sorted = busyIntervals
                    .filter((interval) => Number.isFinite(interval.startMs) && Number.isFinite(interval.endMs) && interval.endMs > interval.startMs)
                    .sort((left, right) => left.startMs - right.startMs);
                let cursor = requestedStartMs;
                for (const interval of sorted) {
                    if (cursor + totalSeconds * 1000 <= interval.startMs)
                        break;
                    if (interval.endMs > cursor) {
                        cursor = interval.endMs;
                    }
                }
                const dayEnd = new Date(`${date}T23:59:59`).getTime();
                if (cursor + totalSeconds * 1000 > dayEnd) {
                    throw new Error("no available free slot to apply template today");
                }
                appliedStartMs = cursor;
                appliedEndMs = cursor + totalSeconds * 1000;
                shifted = true;
            }
            const blockId = nextMockId("blk");
            const block = {
                id: blockId,
                instance: `studio:${templateId}:${date}:${Date.now()}`,
                date,
                start_at: new Date(appliedStartMs).toISOString(),
                end_at: new Date(appliedEndMs).toISOString(),
                firmness: "draft",
                planned_pomodoros: Math.max(1, Math.round(totalSeconds / 1500)),
                source: "routine_studio",
                source_id: templateId,
                recipe_id: templateId,
                auto_drive_mode: String(recipe.auto_drive_mode || recipe.autoDriveMode || "manual"),
                contents: {},
            };
            mockState.blocks.push(block);
            return {
                template_id: templateId,
                date,
                requested_start_at: requestedStart.toISOString(),
                requested_end_at: requestedEnd.toISOString(),
                applied_start_at: new Date(appliedStartMs).toISOString(),
                applied_end_at: new Date(appliedEndMs).toISOString(),
                shifted,
                conflict_count: conflictCount,
                block_id: blockId,
            };
        }
        case "list_tasks":
            return [...mockState.tasks];
        case "create_task": {
            const task = {
                id: nextMockId("tsk"),
                title: readString(args, "title", "New Task"),
                description: typeof args.description === "string" ? args.description : null,
                estimated_pomodoros: typeof args.estimated_pomodoros === "number" ? args.estimated_pomodoros : null,
                completed_pomodoros: 0,
                status: "pending",
                created_at: nowIso(),
            };
            mockState.tasks.push(task);
            return task;
        }
        case "update_task": {
            const taskId = readString(args, "task_id");
            const task = mockState.tasks.find((item) => item.id === taskId);
            if (!task)
                throw new Error("task not found");
            if (typeof args.title === "string")
                task.title = args.title;
            if (typeof args.description === "string")
                task.description = args.description || null;
            if (typeof args.status === "string")
                task.status = args.status;
            if (typeof args.estimated_pomodoros === "number")
                task.estimated_pomodoros = args.estimated_pomodoros;
            return { ...task };
        }
        case "delete_task":
            unassignMockTask(readString(args, "task_id"));
            mockState.tasks = mockState.tasks.filter((item) => item.id !== readString(args, "task_id"));
            return true;
        case "split_task": {
            const parts = Number(args.parts ?? 0);
            if (!Number.isInteger(parts) || parts < 2) {
                throw new Error("parts must be >= 2");
            }
            const parent = mockState.tasks.find((item) => item.id === readString(args, "task_id"));
            if (!parent)
                throw new Error("task not found");
            const estimated = parent.estimated_pomodoros;
            const childEstimate = typeof estimated === "number" ? Math.max(1, Math.ceil(estimated / parts)) : null;
            parent.status = "deferred";
            unassignMockTask(parent.id);
            if (mockState.pomodoro.current_task_id === parent.id) {
                mockState.pomodoro.current_task_id = null;
            }
            const children = [];
            for (let index = 1; index <= parts; index += 1) {
                const child = {
                    id: nextMockId("tsk"),
                    title: `${parent.title} (${index}/${parts})`,
                    description: parent.description ?? null,
                    estimated_pomodoros: childEstimate,
                    completed_pomodoros: 0,
                    status: "pending",
                    created_at: nowIso(),
                };
                mockState.tasks.push(child);
                children.push(child);
            }
            return children;
        }
        case "carry_over_task": {
            const taskId = readString(args, "task_id").trim();
            const fromBlockId = readString(args, "from_block_id").trim();
            if (!taskId || !fromBlockId) {
                throw new Error("task_id and from_block_id are required");
            }
            const task = mockState.tasks.find((item) => item.id === taskId);
            if (!task)
                throw new Error("task not found");
            const fromBlock = mockState.blocks.find((item) => item.id === fromBlockId);
            if (!fromBlock)
                throw new Error("block not found");
            const requested = readStringArray(args, "candidate_block_ids");
            const candidates = [...mockState.blocks]
                .filter((block) => block.id !== fromBlock.id)
                .filter((block) => block.date === fromBlock.date)
                .filter((block) => new Date(block.start_at).getTime() >= new Date(fromBlock.end_at).getTime())
                .filter((block) => requested.length === 0 || requested.includes(block.id))
                .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
            const next = candidates.find((block) => !mockState.taskAssignmentsByBlock[block.id]);
            if (!next) {
                throw new Error("no available block for carry-over");
            }
            assignMockTask(taskId, next.id);
            task.status = "in_progress";
            return {
                task_id: taskId,
                from_block_id: fromBlockId,
                to_block_id: next.id,
                status: task.status,
            };
        }
        case "list_blocks": {
            const date = readString(args, "date") || null;
            const blocks = date
                ? mockState.blocks.filter((block) => block.date === date)
                : mockState.blocks;
            return [...blocks];
        }
        case "list_synced_events": {
            const accountId = normalizeAccountId(args.account_id);
            const timeMin = new Date(readString(args, "time_min", "1970-01-01T00:00:00.000Z")).getTime();
            const timeMax = new Date(readString(args, "time_max", "2999-12-31T23:59:59.000Z")).getTime();
            const entries = args.account_id == null
                ? Object.entries(mockState.syncedEventsByAccount).flatMap(([entryAccountId, events]) => events.map((event) => ({ ...event, account_id: entryAccountId })))
                : (mockState.syncedEventsByAccount[accountId] || []).map((event) => ({
                    ...event,
                    account_id: accountId,
                }));
            return entries
                .filter((event) => {
                const startMs = new Date(event.start_at).getTime();
                const endMs = new Date(event.end_at).getTime();
                if (!Number.isFinite(startMs) || !Number.isFinite(endMs))
                    return false;
                return endMs > timeMin && startMs < timeMax;
            })
                .sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
        }
        case "generate_today_blocks":
            return mockInvoke("generate_blocks", { ...args, date: readString(args, "date", isoDate(new Date())) });
        case "generate_blocks":
        case "generate_one_block": {
            ensureMockRecipesSeeded();
            const date = readString(args, "date", isoDate(new Date()));
            const existing = mockState.blocks.filter((block) => block.date === date);
            const isOneShot = name === "generate_one_block";
            const generated = [];
            for (let hour = 9; hour < 18; hour += 1) {
                if (isOneShot && generated.length >= 1) {
                    break;
                }
                const startAt = new Date(`${date}T${String(hour).padStart(2, "0")}:00:00.000Z`);
                const endAt = new Date(startAt.getTime() + 60 * 60000);
                const collides = existing.some((block) => {
                    const startMs = new Date(block.start_at).getTime();
                    const endMs = new Date(block.end_at).getTime();
                    return startAt.getTime() < endMs && startMs < endAt.getTime();
                });
                if (!isOneShot && collides) {
                    continue;
                }
                const block = {
                    id: nextMockId("blk"),
                    instance: `mock:${date}:${mockState.sequence}`,
                    date,
                    start_at: startAt.toISOString(),
                    end_at: endAt.toISOString(),
                    firmness: "draft",
                    planned_pomodoros: 2,
                    source: "routine",
                    source_id: "mock",
                    recipe_id: "rcp-default",
                    auto_drive_mode: "manual",
                    contents: { task_refs: [], checklist: [], time_splits: [], memo: null },
                };
                mockState.blocks.push(block);
                existing.push(block);
                generated.push(block);
            }
            return generated;
        }
        case "approve_blocks":
            mockState.blocks = mockState.blocks.map((block) => readStringArray(args, "block_ids").includes(block.id) ? { ...block, firmness: "soft" } : block);
            return mockState.blocks.filter((block) => readStringArray(args, "block_ids").includes(block.id));
        case "delete_block":
            if (mockState.taskAssignmentsByBlock[readString(args, "block_id")]) {
                const taskId = mockState.taskAssignmentsByBlock[readString(args, "block_id")];
                delete mockState.taskAssignmentsByBlock[readString(args, "block_id")];
                if (taskId) {
                    delete mockState.taskAssignmentsByTask[taskId];
                }
            }
            mockState.blocks = mockState.blocks.filter((block) => block.id !== readString(args, "block_id"));
            return true;
        case "adjust_block_time":
            mockState.blocks = mockState.blocks.map((block) => block.id === readString(args, "block_id")
                ? { ...block, start_at: readString(args, "start_at"), end_at: readString(args, "end_at") }
                : block);
            return mockState.blocks.find((block) => block.id === readString(args, "block_id"));
        case "start_block_timer":
        case "start_pomodoro":
            if (typeof args.task_id === "string" && args.task_id) {
                assignMockTask(args.task_id, readString(args, "block_id"));
                const task = mockState.tasks.find((item) => item.id === args.task_id);
                if (task && task.status !== "completed") {
                    task.status = "in_progress";
                }
            }
            const targetBlock = mockState.blocks.find((block) => block.id === readString(args, "block_id"));
            const plan = targetBlock
                ? mockSessionPlan(targetBlock)
                : { totalCycles: 1, focusSeconds: 25 * 60, breakSeconds: 5 * 60 };
            mockState.pomodoro = {
                current_block_id: readString(args, "block_id"),
                current_task_id: typeof args.task_id === "string" ? args.task_id : null,
                phase: "focus",
                remaining_seconds: plan.focusSeconds,
                start_time: nowIso(),
                total_cycles: plan.totalCycles,
                completed_cycles: 0,
                current_cycle: 1,
                focus_seconds: plan.focusSeconds,
                break_seconds: plan.breakSeconds,
                paused_phase: null,
            };
            return { ...mockState.pomodoro };
        case "next_step":
        case "advance_pomodoro": {
            const totalCycles = Math.max(1, Number(mockState.pomodoro.total_cycles || 1));
            if (mockState.pomodoro.phase === "focus") {
                mockState.pomodoro = {
                    ...mockState.pomodoro,
                    phase: "break",
                    completed_cycles: Math.min(totalCycles, (mockState.pomodoro.completed_cycles || 0) + 1),
                    remaining_seconds: mockState.pomodoro.break_seconds || 300,
                };
            }
            else if (mockState.pomodoro.phase === "break") {
                if ((mockState.pomodoro.completed_cycles || 0) >= totalCycles) {
                    mockState.pomodoro = {
                        ...emptyMockPomodoroState(),
                    };
                }
                else {
                    mockState.pomodoro = {
                        ...mockState.pomodoro,
                        phase: "focus",
                        current_cycle: (mockState.pomodoro.current_cycle || 1) + 1,
                        remaining_seconds: mockState.pomodoro.focus_seconds || 1500,
                    };
                }
            }
            return { ...mockState.pomodoro };
        }
        case "pause_timer":
        case "pause_pomodoro":
            mockState.pomodoro = { ...mockState.pomodoro, phase: "paused" };
            mockState.logs.push({
                id: nextMockId("pom"),
                block_id: mockState.pomodoro.current_block_id ?? "-",
                task_id: mockState.pomodoro.current_task_id,
                phase: "focus",
                start_time: nowIso(),
                end_time: nowIso(),
                interruption_reason: readString(args, "reason", "paused"),
            });
            return { ...mockState.pomodoro };
        case "resume_timer":
        case "resume_pomodoro":
            mockState.pomodoro = { ...mockState.pomodoro, phase: "focus" };
            return { ...mockState.pomodoro };
        case "interrupt_timer":
            appendMockPomodoroLog(mockState.pomodoro.phase || "focus", readString(args, "reason", "interrupted"));
            mockState.pomodoro = {
                ...emptyMockPomodoroState(),
            };
            return { ...mockState.pomodoro };
        case "complete_pomodoro":
            mockState.pomodoro = {
                ...emptyMockPomodoroState(),
            };
            return { ...mockState.pomodoro };
        case "get_pomodoro_state":
            return { ...mockState.pomodoro };
        case "relocate_if_needed": {
            const accountId = normalizeAccountId(args.account_id);
            const block = mockState.blocks.find((item) => item.id === readString(args, "block_id"));
            if (!block)
                throw new Error("block not found");
            const currentStartMs = new Date(block.start_at).getTime();
            const currentEndMs = new Date(block.end_at).getTime();
            if (!Number.isFinite(currentStartMs) || !Number.isFinite(currentEndMs) || currentEndMs <= currentStartMs) {
                return null;
            }
            const collisions = (mockState.syncedEventsByAccount[accountId] || []).filter((event) => {
                const startMs = new Date(event.start_at).getTime();
                const endMs = new Date(event.end_at).getTime();
                return Number.isFinite(startMs) && Number.isFinite(endMs) && currentStartMs < endMs && startMs < currentEndMs;
            });
            if (collisions.length === 0) {
                return null;
            }
            const latestCollisionEnd = collisions
                .map((event) => new Date(event.end_at).getTime())
                .reduce((max, value) => Math.max(max, value), currentStartMs);
            const durationMs = currentEndMs - currentStartMs;
            block.start_at = new Date(latestCollisionEnd).toISOString();
            block.end_at = new Date(latestCollisionEnd + durationMs).toISOString();
            return { ...block };
        }
        case "get_reflection_summary":
            return {
                start: readString(args, "start", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()),
                end: readString(args, "end", nowIso()),
                completed_count: 1,
                interrupted_count: mockState.logs.length,
                total_focus_minutes: 42,
                logs: [...mockState.logs],
            };
        default:
            throw new Error(`mock command not implemented: ${name}`);
    }
    };

    return mockInvoke;
}

