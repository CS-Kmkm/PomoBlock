use crate::application::configured_modules;
use crate::application::configured_recipes;
use crate::domain::models::{Module, Recipe};
use crate::infrastructure::error::InfraError;

pub fn list_recipes_impl(state: &super::legacy::AppState) -> Result<Vec<Recipe>, InfraError> {
    Ok(configured_recipes::load_configured_recipes(state.config_dir()))
}

pub fn create_recipe_impl(
    state: &super::legacy::AppState,
    payload: serde_json::Value,
) -> Result<Recipe, InfraError> {
    let recipe = configured_recipes::create_recipe(state.config_dir(), &payload)?;
    state.log_info("create_recipe", &format!("created recipe_id={}", recipe.id));
    Ok(recipe)
}

pub fn update_recipe_impl(
    state: &super::legacy::AppState,
    recipe_id: String,
    payload: serde_json::Value,
) -> Result<Recipe, InfraError> {
    let recipe = configured_recipes::update_recipe(state.config_dir(), &recipe_id, &payload)?;
    state.log_info("update_recipe", &format!("updated recipe_id={}", recipe.id));
    Ok(recipe)
}

pub fn delete_recipe_impl(
    state: &super::legacy::AppState,
    recipe_id: String,
) -> Result<bool, InfraError> {
    let deleted = configured_recipes::delete_recipe(state.config_dir(), &recipe_id)?;
    if deleted {
        state.log_info("delete_recipe", &format!("deleted recipe_id={}", recipe_id));
    }
    Ok(deleted)
}

pub fn list_modules_impl(state: &super::legacy::AppState) -> Result<Vec<Module>, InfraError> {
    Ok(configured_modules::load_configured_modules(state.config_dir()))
}

pub fn create_module_impl(
    state: &super::legacy::AppState,
    payload: serde_json::Value,
) -> Result<Module, InfraError> {
    let module = configured_modules::create_module(state.config_dir(), &payload)?;
    state.log_info("create_module", &format!("created module_id={}", module.id));
    Ok(module)
}

pub fn update_module_impl(
    state: &super::legacy::AppState,
    module_id: String,
    payload: serde_json::Value,
) -> Result<Module, InfraError> {
    let module = configured_modules::update_module(state.config_dir(), &module_id, &payload)?;
    state.log_info("update_module", &format!("updated module_id={}", module.id));
    Ok(module)
}

pub fn delete_module_impl(
    state: &super::legacy::AppState,
    module_id: String,
) -> Result<bool, InfraError> {
    let deleted = configured_modules::delete_module(state.config_dir(), &module_id)?;
    if deleted {
        state.log_info("delete_module", &format!("deleted module_id={}", module_id));
    }
    Ok(deleted)
}
