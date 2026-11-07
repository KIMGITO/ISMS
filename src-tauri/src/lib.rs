#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("cmd")
      .args(["/C", "start", "", &url])
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&url)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Raw ESC/POS printing to Wi-Fi / LAN receipt printers (TCP port 9100), using only std.
mod network_printer {
  use std::io::Write;
  use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
  use std::time::Duration;

  #[derive(serde::Serialize)]
  pub struct FoundPrinter {
    host: String,
    port: u16,
  }

  #[derive(serde::Serialize)]
  pub struct ScanResult {
    list: Vec<FoundPrinter>,
    subnet: String,
  }

  fn socket_addr(host: &str, port: u16) -> Result<SocketAddr, String> {
    let ip: IpAddr = host.trim().parse().map_err(|_| format!("\"{}\" is not an IP address.", host.trim()))?;
    Ok(SocketAddr::new(ip, port))
  }

  fn port_open(addr: SocketAddr, timeout: Duration) -> bool {
    TcpStream::connect_timeout(&addr, timeout).is_ok()
  }

  /// The address this computer uses on the local network. Connecting a UDP socket sends nothing.
  fn local_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    match socket.local_addr().ok()?.ip() {
      IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
      _ => None,
    }
  }

  #[tauri::command]
  pub async fn printer_scan_network(port: Option<u16>, timeout_ms: Option<u64>) -> Result<ScanResult, String> {
    let port = port.unwrap_or(9100);
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(400).clamp(150, 2000));
    tauri::async_runtime::spawn_blocking(move || {
      let own = local_ipv4().ok_or("This computer is not on a local network. Connect it to the printer's network and search again.")?;
      let [a, b, c, d] = own.octets();
      let hosts: Vec<u8> = (1..=254u8).filter(|h| *h != d).collect();
      let mut found = Vec::new();
      for chunk in hosts.chunks(64) {
        let handles: Vec<_> = chunk
          .iter()
          .map(|h| {
            let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(a, b, c, *h)), port);
            std::thread::spawn(move || if port_open(addr, timeout) { Some(addr.ip().to_string()) } else { None })
          })
          .collect();
        for handle in handles {
          if let Ok(Some(host)) = handle.join() {
            found.push(FoundPrinter { host, port });
          }
        }
      }
      Ok(ScanResult { list: found, subnet: format!("{}.{}.{}.0/24", a, b, c) })
    })
    .await
    .map_err(|e| e.to_string())?
  }

  #[tauri::command]
  pub async fn printer_probe(host: String, port: Option<u16>, timeout_ms: Option<u64>) -> Result<bool, String> {
    let addr = socket_addr(&host, port.unwrap_or(9100))?;
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(1500).clamp(150, 5000));
    tauri::async_runtime::spawn_blocking(move || Ok(port_open(addr, timeout)))
      .await
      .map_err(|e| e.to_string())?
  }

  #[tauri::command]
  pub async fn printer_send(host: String, port: Option<u16>, data: Vec<u8>) -> Result<(), String> {
    let addr = socket_addr(&host, port.unwrap_or(9100))?;
    tauri::async_runtime::spawn_blocking(move || {
      let unreachable = |_| format!("Could not reach the printer at {}. Check that it is on and on this network.", addr.ip());
      let mut stream = TcpStream::connect_timeout(&addr, Duration::from_secs(4)).map_err(unreachable)?;
      stream.set_write_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
      stream.write_all(&data).map_err(|_| "The printer stopped responding while printing.".to_string())?;
      stream.flush().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_notification::init())
    .invoke_handler(tauri::generate_handler![
      open_url,
      network_printer::printer_scan_network,
      network_printer::printer_probe,
      network_printer::printer_send
    ])
    .setup(|app| {
      // Updates come from GitHub Releases, signed with the key in TAURI_SIGNING_PRIVATE_KEY.
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
