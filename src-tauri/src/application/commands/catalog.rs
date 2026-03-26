use crate::application::configured_modules;
use crate::application::configured_recipes;
use crate::domain::models::{Module, ModuleFolder, Recipe};
use crate::infrastructure::error::InfraError;

pub fn list_recipes_impl(state: &super::bootstrap::AppState) -> Result<Vec<Recipe>, InfraError> {
    Ok(configured_recipes::load_configured_recipes(state.config_dir()))
}

pub fn create_recipe_impl(
    state: &super::bootstrap::AppState,
    payload: serde_json::Value,
) -> Result<Recipe, InfraError> {
    let recipe = configured_recipes::create_recipe(state.config_dir(), &payload)?;
    state.log_info("create_recipe", &format!("created recipe_id={}", recipe.id));
    Ok(recipe)
}

pub fn update_recipe_impl(
    state: &super::bootstrap::AppState,
    recipe_id: String,
    payload: serde_json::Value,
) -> Result<Recipe, InfraError> {
    let recipe = configured_recipes::update_recipe(state.config_dir(), &recipe_id, &payload)?;
    state.log_info("update_recipe", &format!("updated recipe_id={}", recipe.id));
    Ok(recipe)
}

pub fn delete_recipe_impl(
    state: &super::bootstrap::AppState,
    recipe_id: String,
) -> Result<bool, InfraError> {
    let deleted = configured_recipes::delete_recipe(state.config_dir(), &recipe_id)?;
    if deleted {
        state.log_info("delete_recipe", &format!("deleted recipe_id={}", recipe_id));
    }
    Ok(deleted)
}

pub fn list_modules_impl(state: &super::bootstrap::AppState) -> Result<Vec<Module>, InfraError> {
    Ok(configured_modules::load_configured_modules(state.config_dir()))
}

pub fn list_module_folders_impl(
    state: &super::bootstrap::AppState,
) -> Result<Vec<ModuleFolder>, InfraError> {
    Ok(configured_modules::load_configured_module_folders(state.config_dir()))
}

pub fn create_module_impl(
    state: &super::bootstrap::AppState,
    payload: serde_json::Value,
) -> Result<Module, InfraError> {
    let module = configured_modules::create_module(state.config_dir(), &payload)?;
    state.log_info("create_module", &format!("created module_id={}", module.id));
    Ok(module)
}

pub fn update_module_impl(
    state: &super::bootstrap::AppState,
    module_id: String,
    payload: serde_json::Value,
) -> Result<Module, InfraError> {
    let module = configured_modules::update_module(state.config_dir(), &module_id, &payload)?;
    state.log_info("update_module", &format!("updated module_id={}", module.id));
    Ok(module)
}

pub fn delete_module_impl(
    state: &super::bootstrap::AppState,
    module_id: String,
) -> Result<bool, InfraError> {
    let deleted = configured_modules::delete_module(state.config_dir(), &module_id)?;
    if deleted {
        state.log_info("delete_module", &format!("deleted module_id={}", module_id));
    }
    Ok(deleted)
}

pub fn create_module_folder_impl(
    state: &super::bootstrap::AppState,
    name: String,
) -> Result<ModuleFolder, InfraError> {
    let folder = configured_modules::create_module_folder(state.config_dir(), &name)?;
    state.log_info(
        "create_module_folder",
        &format!("created folder_id={}", folder.id),
    );
    Ok(folder)
}

pub fn delete_module_folder_impl(
    state: &super::bootstrap::AppState,
    folder_id: String,
) -> Result<bool, InfraError> {
    let deleted = configured_modules::delete_module_folder(state.config_dir(), &folder_id)?;
    if deleted {
        state.log_info(
            "delete_module_folder",
            &format!("deleted folder_id={}", folder_id),
        );
    }
    Ok(deleted)
}

pub fn move_module_folder_impl(
    state: &super::bootstrap::AppState,
    folder_id: String,
    direction: String,
) -> Result<Vec<ModuleFolder>, InfraError> {
    let folders =
        configured_modules::move_module_folder(state.config_dir(), &folder_id, &direction)?;
    state.log_info(
        "move_module_folder",
        &format!("moved folder_id={} direction={}", folder_id, direction),
    );
    Ok(folders)
}

pub fn move_module_impl(
    state: &super::bootstrap::AppState,
    module_id: String,
    folder_id: String,
    before_module_id: Option<String>,
) -> Result<Vec<Module>, InfraError> {
    let modules = configured_modules::move_module(
        state.config_dir(),
        &module_id,
        &folder_id,
        before_module_id.as_deref(),
    )?;
    state.log_info(
        "move_module",
        &format!(
            "moved module_id={} folder_id={} before_module_id={}",
            module_id,
            folder_id,
            before_module_id.as_deref().unwrap_or("")
        ),
    );
    Ok(modules)
}
