use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// Ultra-lightweight network check
///
/// Simply tries to connect to Telegram's servers without using grammers.
/// This avoids the stack overflow bug from grammers reconnection logic.
#[tauri::command]
pub async fn cmd_is_network_available() -> Result<bool, String> {
    // Try to connect to Telegram's production DC
    // Using a very short timeout to keep it lightweight
    tokio::task::spawn_blocking(|| {
        let address: SocketAddr = "149.154.167.50:443"
            .parse()
            .map_err(|e| format!("Invalid Telegram network check address: {}", e))?;

        // Try connecting to Telegram DC2 (149.154.167.50:443)
        match TcpStream::connect_timeout(&address, Duration::from_secs(2)) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
