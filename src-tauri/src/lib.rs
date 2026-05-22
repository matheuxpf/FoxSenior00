use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Emitter;
use tauri::Manager;

#[derive(Clone, serde::Serialize)]
struct PrintJobPayload {
    job_id: u32,
    status: String,
    message: String,
}

#[derive(Serialize, Deserialize)]
pub struct TemplateData {
    linhas: Vec<String>,
    fontes: Vec<u32>,
}

fn obter_caminho_templates() -> std::path::PathBuf {
    // Helper para verificar se uma pasta existe e é um diretório
    let e_diretorio_valido = |path: &std::path::Path| -> bool {
        let exists = path.exists() && path.is_dir();
        println!(
            "[FoxSenior Backend] Verificando pasta: {:?} -> Existe e é Dir? {}",
            path, exists
        );
        exists
    };

    // 1. Tenta encontrar a pasta "templates" no Cwd ou subindo
    if let Ok(mut dir) = std::env::current_dir() {
        println!("[FoxSenior Backend] Buscando a partir do Cwd: {:?}", dir);
        loop {
            let temp_path = dir.join("templates");
            if e_diretorio_valido(&temp_path) {
                return temp_path;
            }
            if !dir.pop() {
                break;
            }
        }
    }

    // 2. Tenta encontrar a partir do executável ou subindo
    if let Ok(exe_path) = std::env::current_exe() {
        println!(
            "[FoxSenior Backend] Buscando a partir do Executável: {:?}",
            exe_path
        );
        let mut dir = exe_path.parent().map(|p| p.to_path_buf());
        while let Some(mut d) = dir {
            let temp_path = d.join("templates");
            if e_diretorio_valido(&temp_path) {
                return temp_path;
            }
            if !d.pop() {
                break;
            }
            dir = Some(d);
        }
    }

    // 3. Fallback: Pasta "templates" no Cwd
    let fallback = std::env::current_dir()
        .unwrap_or_default()
        .join("templates");
    if !fallback.exists() {
        let _ = std::fs::create_dir(&fallback);
    }
    fallback
}

#[tauri::command]
fn listar_templates() -> Result<Vec<String>, String> {
    let pasta = obter_caminho_templates();
    println!("[FoxSenior Backend] Listando templates em: {:?}", pasta);

    let entries =
        fs::read_dir(&pasta).map_err(|e| format!("Erro ao ler pasta de templates: {}", e))?;
    let mut arquivos = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() {
            let ext = path
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            // Aceita .txt, .out ou arquivos sem extensão que podem ser templates
            if ext == "txt" || ext == "out" || ext == "" {
                if let Some(name) = path.file_name() {
                    arquivos.push(name.to_string_lossy().into_owned());
                }
            }
        }
    }
    arquivos.sort();
    Ok(arquivos)
}

fn decode_latin1(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|&b| match b {
            0x80 => '€',
            0x82 => '‚',
            0x83 => 'ƒ',
            0x84 => '„',
            0x85 => '…',
            0x86 => '†',
            0x87 => '‡',
            0x88 => 'ˆ',
            0x89 => '‰',
            0x8A => 'Š',
            0x8B => '‹',
            0x8C => 'Œ',
            0x8E => 'Ž',
            0x91 => '‘',
            0x92 => '’',
            0x93 => '“',
            0x94 => '”',
            0x95 => '•',
            0x96 => '–',
            0x97 => '—',
            0x98 => '˜',
            0x99 => '™',
            0x9A => 'š',
            0x9B => '›',
            0x9C => 'œ',
            0x9E => 'ž',
            0x9F => 'Ÿ',
            _ => b as char,
        })
        .collect()
}

#[tauri::command]
fn ler_template(nome: String) -> Result<TemplateData, String> {
    let path = obter_caminho_templates().join(nome);
    let bytes = fs::read(path).map_err(|e| e.to_string())?;

    let conteudo = match String::from_utf8(bytes.clone()) {
        Ok(s) => s,
        Err(_) => decode_latin1(&bytes),
    };

    let mut linhas = Vec::new();
    let mut fontes = Vec::new();

    for line in conteudo.lines() {
        if line.contains('|') {
            let parts: Vec<&str> = line.split('|').collect();
            let font_part = parts[0];
            let content_part = if parts.len() > 1 { parts[1] } else { "" };

            // Parse font, e.g. "25 - 0" or just "25"
            let font_sz = if font_part.contains('-') {
                font_part
                    .split('-')
                    .next()
                    .unwrap_or("25")
                    .trim()
                    .parse::<u32>()
                    .unwrap_or(25)
            } else {
                font_part.trim().parse::<u32>().unwrap_or(25)
            };

            linhas.push(content_part.to_string());
            fontes.push(font_sz);
        } else {
            linhas.push(line.to_string());
            fontes.push(25);
        }
    }

    Ok(TemplateData { linhas, fontes })
}

#[tauri::command]
fn salvar_template(nome: String, linhas: Vec<String>, fontes: Vec<u32>) -> Result<(), String> {
    let path = obter_caminho_templates().join(nome);
    let mut conteudo = String::new();

    for i in 0..linhas.len() {
        let lin = &linhas[i];
        let font = fontes.get(i).copied().unwrap_or(25);
        conteudo.push_str(&format!("{} - 0|{}\n", font, lin));
    }

    fs::write(path, conteudo).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn listar_impressoras() -> Result<Vec<String>, String> {
    use std::ptr;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::Graphics::Printing::{
        EnumPrintersW, PRINTER_ENUM_CONNECTIONS, PRINTER_ENUM_LOCAL, PRINTER_INFO_2W,
    };

    println!("[FoxSenior Backend] listar_impressoras acionado.");

    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed = 0u32;
    let mut returned = 0u32;

    // Call first time to get required buffer size
    unsafe {
        EnumPrintersW(
            flags,
            ptr::null(),
            2,
            ptr::null_mut(),
            0,
            &mut needed,
            &mut returned,
        );
    }

    if needed == 0 {
        println!("[FoxSenior Backend] Nenhuma impressora encontrada (needed=0).");
        return Ok(Vec::new());
    }

    println!("[FoxSenior Backend] Buffer necessário: {} bytes", needed);

    let mut buffer = vec![0u8; needed as usize];
    let success = unsafe {
        EnumPrintersW(
            flags,
            ptr::null(),
            2,
            buffer.as_mut_ptr(),
            needed,
            &mut needed,
            &mut returned,
        )
    };

    if success == 0 {
        let err = unsafe { GetLastError() };
        println!(
            "[FoxSenior Backend] Falha ao listar impressoras. Código Win32: {}",
            err
        );
        return Err(format!(
            "Falha ao listar as impressoras do sistema (Erro {}).",
            err
        ));
    }

    let mut printers = Vec::new();
    let printer_info_ptr = buffer.as_ptr() as *const PRINTER_INFO_2W;
    for i in 0..returned {
        let info = unsafe { &*printer_info_ptr.add(i as usize) };
        if !info.pPrinterName.is_null() {
            let name_len = unsafe {
                (0..)
                    .take_while(|&j| *info.pPrinterName.add(j) != 0)
                    .count()
            };
            let name_slice = unsafe { std::slice::from_raw_parts(info.pPrinterName, name_len) };
            if let Ok(name) = String::from_utf16(name_slice) {
                println!("[FoxSenior Backend] Encontrada impressora: {}", name);
                printers.push(name);
            }
        }
    }

    println!(
        "[FoxSenior Backend] Total de impressoras encontradas: {}",
        printers.len()
    );
    Ok(printers)
}

#[tauri::command]
fn obter_impressora_padrao() -> Result<Option<String>, String> {
    use windows_sys::Win32::Graphics::Printing::GetDefaultPrinterW;
    let mut size = 0u32;
    unsafe {
        GetDefaultPrinterW(std::ptr::null_mut(), &mut size);
    }
    if size == 0 {
        return Ok(None);
    }
    let mut buffer = vec![0u16; size as usize];
    let success = unsafe { GetDefaultPrinterW(buffer.as_mut_ptr(), &mut size) };
    if success == 0 {
        return Ok(None);
    }
    let len = buffer.iter().position(|&x| x == 0).unwrap_or(buffer.len());
    let name = String::from_utf16(&buffer[..len]).map_err(|e| e.to_string())?;
    Ok(Some(name))
}

#[tauri::command]
fn imprimir_etiqueta(
    window: tauri::WebviewWindow,
    impressora: String,
    linhas: Vec<String>,
    fontes: Vec<u32>,
    copias: u32,
    layout: String,
    escuridao: u32,
    alinhamento: String,
    deslocamento_y: u32,
    deslocamento_x: u32,
) -> Result<(), String> {
    // Generate ZPL
    let mut zpl = format!("~SD{:02}\n^XA\n^PW830\n^CI13\n", escuridao);

    // Parse layout as an integer representing the number of columns (1 to 6)
    let cols = if layout.trim() == "2_refresco" {
        2
    } else {
        layout.trim().parse::<usize>().unwrap_or(1)
    };

    // Configuração de largura total e espaçamento entre colunas (em pontos de impressão Zebra)
    // Para etiquetas duplas (refresco/dupla), otimizado para centralizar em etiquetas de 4 polegadas (650 pontos)
    let (total_width, gap, x_offset) = if cols == 2 {
        (650, 25, deslocamento_x as usize) // Use deslocamento_x como margem inicial
    } else if cols > 2 {
        (800, 10, deslocamento_x as usize)
    } else {
        (832, 0, deslocamento_x as usize) // Use deslocamento_x como margem inicial
    };

    let col_width = if cols > 1 {
        (total_width - (cols - 1) * gap) / cols
    } else {
        total_width
    };

    // Ponto de partida Y absoluto vindo diretamente do controle do slider
    let mut y = deslocamento_y as f32;

    for (i, lin) in linhas.iter().enumerate() {
        let t = lin.trim();
        let h = fontes.get(i).copied().unwrap_or(25);
        if t.is_empty() {
            y += (h as f32) * 1.15; // Linha em branco apenas avança o Y sequencial
            continue;
        }

        // 1. QR Code compiling
        if t.starts_with("[QR:") && t.ends_with(']') {
            let qr_val = &t[4..t.len() - 1];
            for c in 0..cols {
                let x = x_offset + c * (col_width + gap);
                let qr_w = 80;
                let qx = x as i32 + (col_width as i32 - qr_w) / 2;
                let final_qx = if qx < x as i32 { x } else { qx as usize };
                zpl.push_str(&format!(
                    "^FO{},{}^BQN,2,3^FDQA,{}^FS\n",
                    final_qx, y as u32, qr_val
                ));
            }
            y += 95.0;
            continue;
        }

        // 2. Barcode compiling (EAN-13)
        let is_barcode = (t.len() == 13 && t.chars().all(|c| c.is_ascii_digit()))
            || (t.starts_with("[EAN:") && t.ends_with(']'));
        if is_barcode {
            let b_val = if t.starts_with("[EAN:") {
                &t[5..t.len() - 1]
            } else {
                t
            };
            for c in 0..cols {
                let x = x_offset + c * (col_width + gap);
                let barcode_w = 180;
                let bx = x as i32 + (col_width as i32 - barcode_w) / 2;
                let final_bx = if bx < x as i32 { x } else { bx as usize };
                zpl.push_str(&format!(
                    "^BY2,3,60^FO{},{}^BEN,60,Y,N^FD{}^FS\n",
                    final_bx, y as u32, b_val
                ));
            }
            y += 90.0;
            continue;
        }

        // 3. Texto normal
        for c in 0..cols {
            let base_x = x_offset + c * (col_width + gap);

            if alinhamento == "C" {
                // Centralizado: Usa a largura total da coluna sem margens extras
                zpl.push_str(&format!(
                    "^FO{},{}^A0N,{},{}^FB{},1,,C^FD{}^FS\n",
                    base_x, y as u32, h, h, col_width, t
                ));
            } else {
                // Esquerda: Aplica exatamente 10 pontos de margem, como solicitado
                let x_com_margem = base_x + 10;
                let largura_com_margem = if col_width > 10 {
                    col_width - 10
                } else {
                    col_width
                };
                zpl.push_str(&format!(
                    "^FO{},{}^A0N,{},{}^FB{},1,,L^FD{}^FS\n",
                    x_com_margem, y as u32, h, h, largura_com_margem, t
                ));
            }
        }
        y += (h as f32) * 1.15; // Linhas juntinhas com fator 1.15
    }

    zpl.push_str(&format!("^PQ{}\n^XZ", copias));

    // Send RAW to printer via Win32 API
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Printing::{
        ClosePrinter, EndDocPrinter, EndPagePrinter, OpenPrinterW, StartDocPrinterW,
        StartPagePrinter, WritePrinter, DOC_INFO_1W,
    };

    let mut printer_handle = 0isize;
    let printer_name_wide: Vec<u16> = std::ffi::OsStr::new(&impressora)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let success = unsafe {
        OpenPrinterW(
            printer_name_wide.as_ptr(),
            &mut printer_handle,
            std::ptr::null(),
        )
    };
    if success == 0 {
        return Err(format!(
            "Não foi possível abrir a impressora '{}'.",
            impressora
        ));
    }

    let doc_name = std::ffi::OsStr::new("FoxSenior Label")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();
    let data_type = std::ffi::OsStr::new("RAW")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<u16>>();

    let doc_info = DOC_INFO_1W {
        pDocName: doc_name.as_ptr() as *mut u16,
        pOutputFile: std::ptr::null_mut(),
        pDatatype: data_type.as_ptr() as *mut u16,
    };

    let job_id = unsafe { StartDocPrinterW(printer_handle, 1, &doc_info as *const _) };
    if job_id == 0 {
        unsafe {
            ClosePrinter(printer_handle);
        }
        return Err("Não foi possível iniciar o trabalho de impressão.".to_string());
    }

    let success = unsafe { StartPagePrinter(printer_handle) };
    if success == 0 {
        unsafe {
            EndDocPrinter(printer_handle);
            ClosePrinter(printer_handle);
        }
        return Err("Não foi possível iniciar a página de impressão.".to_string());
    }

    let bytes = zpl.as_bytes();
    let mut bytes_written = 0u32;
    let success = unsafe {
        WritePrinter(
            printer_handle,
            bytes.as_ptr() as *const _,
            bytes.len() as u32,
            &mut bytes_written,
        )
    };

    unsafe {
        EndPagePrinter(printer_handle);
        EndDocPrinter(printer_handle);
        ClosePrinter(printer_handle);
    }

    if success == 0 || bytes_written != bytes.len() as u32 {
        return Err("Falha ao enviar os dados para a impressora.".to_string());
    }

    // Spawn spooler tracking thread
    let window_clone = window.clone();
    let printer_name_for_thread = impressora.clone();
    std::thread::spawn(move || {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Foundation::GetLastError;
        use windows_sys::Win32::Graphics::Printing::{
            ClosePrinter, GetJobW, OpenPrinterW, JOB_INFO_1W,
        };

        // Open a separate printer handle for the background thread to avoid FFI race conditions
        let mut thread_printer_handle = 0isize;
        let printer_name_wide: Vec<u16> = std::ffi::OsStr::new(&printer_name_for_thread)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let success = unsafe {
            OpenPrinterW(
                printer_name_wide.as_ptr(),
                &mut thread_printer_handle,
                std::ptr::null(),
            )
        };
        if success == 0 {
            return;
        }

        let mut status_sent = std::collections::HashSet::new();
        let mut elapsed = 0;
        let timeout = 60; // 30 seconds (60 * 500ms)

        // Emit initial spooling status
        let _ = window_clone.emit(
            "print-job-status",
            PrintJobPayload {
                job_id,
                status: "SPOOLING".to_string(),
                message: "Enviando dados para o spooler da impressora...".to_string(),
            },
        );

        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            elapsed += 1;

            let mut needed = 0u32;
            let res = unsafe {
                GetJobW(
                    thread_printer_handle,
                    job_id,
                    1,
                    std::ptr::null_mut(),
                    0,
                    &mut needed,
                )
            };

            if res == 0 {
                let err = unsafe { GetLastError() };
                // If job is 1804 (ERROR_INVALID_JOB_ID) or 87 or 0, it has been completed and cleaned up!
                if err == 1804 || err == 87 || err == 0 {
                    let _ = window_clone.emit(
                        "print-job-status",
                        PrintJobPayload {
                            job_id,
                            status: "SUCCESS".to_string(),
                            message: "Etiqueta impressa com sucesso!".to_string(),
                        },
                    );
                } else {
                    let _ = window_clone.emit(
                        "print-job-status",
                        PrintJobPayload {
                            job_id,
                            status: "FAILED".to_string(),
                            message: format!("Erro ao obter status de impressão (Código {}).", err),
                        },
                    );
                }
                break;
            }

            let mut buffer = vec![0u8; needed as usize];
            let success_get = unsafe {
                GetJobW(
                    thread_printer_handle,
                    job_id,
                    1,
                    buffer.as_mut_ptr(),
                    needed,
                    &mut needed,
                )
            };

            if success_get != 0 {
                let job_info = unsafe { &*(buffer.as_ptr() as *const JOB_INFO_1W) };
                let flags = job_info.Status;

                let (status_str, message_str) = if flags & 0x00000002 != 0 {
                    ("FAILED", "Erro crítico na impressora Zebra.")
                } else if flags & 0x00000020 != 0 {
                    ("OFFLINE", "A impressora está offline. Verifique a conexão.")
                } else if flags & 0x00000040 != 0 {
                    ("PAPER_OUT", "A impressora está sem etiquetas ou papel!")
                } else if flags & 0x00000010 != 0 {
                    ("PRINTING", "A Zebra está imprimindo a etiqueta...")
                } else if flags & 0x00000008 != 0 {
                    ("SPOOLING", "Carregando dados na impressora...")
                } else if flags & 0x00000001 != 0 {
                    ("PAUSED", "A impressora está pausada.")
                } else {
                    ("ACTIVE", "Aguardando na fila de impressão...")
                };

                if !status_sent.contains(status_str) {
                    status_sent.insert(status_str.to_string());
                    let _ = window_clone.emit(
                        "print-job-status",
                        PrintJobPayload {
                            job_id,
                            status: status_str.to_string(),
                            message: message_str.to_string(),
                        },
                    );
                }

                if status_str == "FAILED" || status_str == "OFFLINE" || status_str == "PAPER_OUT" {
                    break;
                }
            }

            if elapsed >= timeout {
                let _ = window_clone.emit(
                    "print-job-status",
                    PrintJobPayload {
                        job_id,
                        status: "TIMEOUT".to_string(),
                        message: "Tempo limite de resposta da impressora excedido.".to_string(),
                    },
                );
                break;
            }
        }

        unsafe {
            ClosePrinter(thread_printer_handle);
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            listar_templates,
            ler_template,
            salvar_template,
            listar_impressoras,
            obter_impressora_padrao,
            imprimir_etiqueta
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
