fn print_status(status: &pomoblock_tauri::WorkspaceStatus) {
    println!("workspace: {}", status.workspace_root);
    println!("configDir: {}", status.config_dir);
    println!("stateDir: {}", status.state_dir);
    println!("logsDir: {}", status.logs_dir);
    println!("database: {}", status.database_path);
}

fn main() {
    let command = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "init".to_string());
    let workspace_root = std::env::args().nth(2);

    match command.as_str() {
        "init" => {
            let status = pomoblock_tauri::workspace_status(workspace_root)
                .expect("failed to bootstrap workspace");
            println!("PomBlock bootstrap completed.");
            print_status(&status);
        }
        "status" => {
            let status = pomoblock_tauri::workspace_status(workspace_root)
                .expect("failed to resolve workspace status");
            print_status(&status);
        }
        _ => panic!("Unknown command: {}", command),
    }
}
