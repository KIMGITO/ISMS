// Background removal for the desktop app, run natively with ONNX Runtime on every CPU core.
//
// The same model the web app uses (ISNet general-use, weight-only int8, MIT,
// xrds/isnet-general-onnx-int8) took 40 s or more in the webview's single-threaded
// WebAssembly and often never finished. Natively it takes about 10 s on a 4-core laptop.
//
// The app downloads the model once (with a progress bar) and hands the bytes to
// `bg_save_model`, which checks them and keeps them in the app's data folder. `bg_remove`
// takes raw RGBA pixels and returns one alpha byte per pixel: the cut-out mask.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;

const MODEL_FILE: &str = "isnet-general-int8.onnx";
/// SHA-256 of onnx/model_quantized.onnx in xrds/isnet-general-onnx-int8.
const MODEL_SHA256: &str = "3b21a6706dc8d6e4ba9f5b31ebc6940f6c785b58862e27bb25daa9dd4424b87f";
const SIDE: usize = 1024;
/// Photos are scaled to at most 1600 px before they get here; this stops anything absurd.
const MAX_PIXELS: usize = 4096 * 4096;

static SESSION: Mutex<Option<Session>> = Mutex::new(None);

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|_| "Could not find the app's data folder.".to_string())?
    .join("models");
  Ok(dir.join(MODEL_FILE))
}

/// True once the model is saved on this computer.
#[tauri::command]
pub fn bg_model_ready(app: tauri::AppHandle) -> bool {
  model_path(&app).map(|p| p.is_file()).unwrap_or(false)
}

/// Saves the downloaded model after checking it is exactly the expected file.
#[tauri::command]
pub async fn bg_save_model(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("The model download was not received.".into());
  };
  let bytes = bytes.clone();
  let path = model_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || {
    let digest = Sha256::digest(&bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    if hex != MODEL_SHA256 {
      return Err("The background remover download was damaged. Try again.".to_string());
    }
    let dir = path.parent().ok_or("Bad model folder.")?;
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not save the background remover: {e}"))?;
    let tmp = path.with_extension("part");
    std::fs::write(&tmp, &bytes).map_err(|e| format!("Could not save the background remover: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Could not save the background remover: {e}"))?;
    Ok(())
  })
  .await
  .map_err(|e| e.to_string())?
}

fn header_num(request: &Request<'_>, name: &str) -> Result<usize, String> {
  request
    .headers()
    .get(name)
    .and_then(|v| v.to_str().ok())
    .and_then(|v| v.parse::<usize>().ok())
    .filter(|n| *n > 0)
    .ok_or_else(|| format!("Missing {name}."))
}

/// Raw RGBA pixels in (headers x-width, x-height), one alpha byte per pixel out.
#[tauri::command]
pub async fn bg_remove(app: tauri::AppHandle, request: Request<'_>) -> Result<Response, String> {
  let width = header_num(&request, "x-width")?;
  let height = header_num(&request, "x-height")?;
  let InvokeBody::Raw(pixels) = request.body() else {
    return Err("The photo was not received.".into());
  };
  if width * height > MAX_PIXELS || pixels.len() != width * height * 4 {
    return Err("The photo could not be read.".into());
  }
  let pixels = pixels.clone();
  let path = model_path(&app)?;

  let mask = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
    let mut guard = SESSION.lock().map_err(|_| "The background remover is busy. Try again.".to_string())?;
    if guard.is_none() {
      if !path.is_file() {
        return Err("The background remover isn't downloaded yet.".into());
      }
      let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
      let session = Session::builder()
        .and_then(|b| b.with_optimization_level(GraphOptimizationLevel::Level3))
        .and_then(|b| b.with_intra_threads(threads))
        .and_then(|b| b.commit_from_file(&path))
        .map_err(|e| {
          // A damaged file would fail every time: remove it so the next try downloads again.
          let _ = std::fs::remove_file(&path);
          format!("The background remover could not start ({e}). Try again to download it fresh.")
        })?;
      *guard = Some(session);
    }
    let session = guard.as_mut().expect("session loaded above");

    let input = to_input(&pixels, width, height);
    let tensor = Tensor::from_array(([1usize, 3, SIDE, SIDE], input.into_boxed_slice())).map_err(|e| e.to_string())?;
    let outputs = session.run(ort::inputs![tensor]).map_err(|e| format!("Background removal failed: {e}"))?;
    let (_, out) = outputs[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    if out.len() < SIDE * SIDE {
      return Err("Background removal gave an unexpected result.".into());
    }
    Ok(to_mask(&out[..SIDE * SIDE], width, height))
  })
  .await
  .map_err(|e| e.to_string())??;

  Ok(Response::new(mask))
}

/// Bilinear resize to 1024 x 1024 and the model's normalisation ((v - 128) / 256), channel-first.
fn to_input(rgba: &[u8], w: usize, h: usize) -> Vec<f32> {
  let mut out = vec![0f32; 3 * SIDE * SIDE];
  let sx = w as f32 / SIDE as f32;
  let sy = h as f32 / SIDE as f32;
  for y in 0..SIDE {
    let fy = ((y as f32 + 0.5) * sy - 0.5).clamp(0.0, (h - 1) as f32);
    let y0 = fy.floor() as usize;
    let y1 = (y0 + 1).min(h - 1);
    let ty = fy - y0 as f32;
    for x in 0..SIDE {
      let fx = ((x as f32 + 0.5) * sx - 0.5).clamp(0.0, (w - 1) as f32);
      let x0 = fx.floor() as usize;
      let x1 = (x0 + 1).min(w - 1);
      let tx = fx - x0 as f32;
      for c in 0..3 {
        let p = |xx: usize, yy: usize| rgba[(yy * w + xx) * 4 + c] as f32;
        let top = p(x0, y0) * (1.0 - tx) + p(x1, y0) * tx;
        let bottom = p(x0, y1) * (1.0 - tx) + p(x1, y1) * tx;
        let v = top * (1.0 - ty) + bottom * ty;
        out[c * SIDE * SIDE + y * SIDE + x] = (v - 128.0) / 256.0;
      }
    }
  }
  out
}

/// Model output (0..1, or logits) to an alpha byte per photo pixel, bilinear upscaled.
fn to_mask(out: &[f32], w: usize, h: usize) -> Vec<u8> {
  let logits = out.iter().any(|&v| v < -1e-5 || v > 1.0 + 1e-5);
  let small: Vec<f32> = out
    .iter()
    .map(|&v| if logits { 1.0 / (1.0 + (-v).exp()) } else { v.clamp(0.0, 1.0) })
    .collect();
  let mut mask = vec![0u8; w * h];
  let sx = SIDE as f32 / w as f32;
  let sy = SIDE as f32 / h as f32;
  for y in 0..h {
    let fy = ((y as f32 + 0.5) * sy - 0.5).clamp(0.0, (SIDE - 1) as f32);
    let y0 = fy.floor() as usize;
    let y1 = (y0 + 1).min(SIDE - 1);
    let ty = fy - y0 as f32;
    for x in 0..w {
      let fx = ((x as f32 + 0.5) * sx - 0.5).clamp(0.0, (SIDE - 1) as f32);
      let x0 = fx.floor() as usize;
      let x1 = (x0 + 1).min(SIDE - 1);
      let tx = fx - x0 as f32;
      let top = small[y0 * SIDE + x0] * (1.0 - tx) + small[y0 * SIDE + x1] * tx;
      let bottom = small[y1 * SIDE + x0] * (1.0 - tx) + small[y1 * SIDE + x1] * tx;
      mask[y * w + x] = ((top * (1.0 - ty) + bottom * ty) * 255.0).round() as u8;
    }
  }
  mask
}
