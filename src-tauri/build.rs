use std::{
    fs,
    io::Cursor,
    path::{Path, PathBuf},
};

fn main() {
    ensure_default_icons();
    heal_relocated_tauri_permission_files();
    tauri_build::build()
}

fn ensure_default_icons() {
    let icon_dir = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("icons");
    let png_path = icon_dir.join("icon.png");
    let ico_path = icon_dir.join("icon.ico");
    if png_path.is_file() && ico_path.is_file() {
        return;
    }
    fs::create_dir_all(&icon_dir).expect("cannot create icon directory");
    let png = make_png();
    fs::write(png_path, &png).expect("cannot write generated PNG icon");
    fs::write(ico_path, make_ico(&png)).expect("cannot write generated ICO icon");
}

fn make_png() -> Vec<u8> {
    const SIZE: usize = 64;
    let mut pixels = vec![0_u8; SIZE * SIZE * 4];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let offset = (y * SIZE + x) * 4;
            let inside_page = (13..=50).contains(&x) && (8..=55).contains(&y);
            let fold = x >= 40 && y <= 18 && x + y >= 58;
            let line =
                inside_page && (20..=45).contains(&x) && matches!(y, 28..=31 | 37..=40 | 46..=49);
            let color = if line {
                [31, 107, 86, 255]
            } else if inside_page && !fold {
                [246, 249, 248, 255]
            } else {
                [27, 43, 52, 255]
            };
            pixels[offset..offset + 4].copy_from_slice(&color);
        }
    }
    let mut encoded = Cursor::new(Vec::new());
    {
        let mut encoder = png::Encoder::new(&mut encoded, SIZE as u32, SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .expect("cannot write PNG header")
            .write_image_data(&pixels)
            .expect("cannot encode PNG icon");
    }
    encoded.into_inner()
}

fn make_ico(png: &[u8]) -> Vec<u8> {
    let mut ico = Vec::with_capacity(22 + png.len());
    ico.extend_from_slice(&[0, 0, 1, 0, 1, 0]);
    ico.extend_from_slice(&[64, 64, 0, 0, 1, 0, 32, 0]);
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22_u32.to_le_bytes());
    ico.extend_from_slice(png);
    ico
}

fn heal_relocated_tauri_permission_files() {
    let Some(manifest_dir) = std::env::var_os("CARGO_MANIFEST_DIR").map(PathBuf::from) else {
        return;
    };
    let build_root = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|out| out.parent().and_then(|p| p.parent()).map(PathBuf::from));

    let env_snapshot: Vec<_> = std::env::vars_os().collect();
    for (key_os, val_os) in env_snapshot {
        let key = key_os.to_string_lossy();
        if !key.starts_with("DEP_") || !key.ends_with("_PATH") {
            continue;
        }
        let mut path = PathBuf::from(&val_os);
        if !path.exists() {
            if let Some(ref root) = build_root {
                if let Some(relocated) =
                    relocate_after_segment(&path.to_string_lossy(), "build", root)
                {
                    std::env::set_var(&key_os, &relocated);
                    path = relocated;
                }
            }
        }
        if key.ends_with("PERMISSION_FILES_PATH") && path.is_file() {
            heal_permission_list_file(&path, &manifest_dir);
        }
    }

    let mut build_roots = Vec::new();
    if let Some(root) = build_root {
        build_roots.push(root);
    }
    let target_dir = manifest_dir.join("target");
    for profile in ["debug", "release"] {
        let candidate = target_dir.join(profile).join("build");
        if candidate.is_dir() && !build_roots.contains(&candidate) {
            build_roots.push(candidate);
        }
    }
    if let Ok(target_entries) = fs::read_dir(&target_dir) {
        for entry in target_entries.flatten() {
            let sub = entry.path();
            if !sub.is_dir() {
                continue;
            }
            for profile in ["debug", "release"] {
                let candidate = sub.join(profile).join("build");
                if candidate.is_dir() && !build_roots.contains(&candidate) {
                    build_roots.push(candidate);
                }
            }
        }
    }
    for root in build_roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            if !name.starts_with("tauri-") {
                continue;
            }
            let out_dir = entry.path().join("out");
            let Ok(out_entries) = fs::read_dir(&out_dir) else {
                continue;
            };
            for out_entry in out_entries.flatten() {
                let out_path = out_entry.path();
                if out_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.ends_with("-permission-files"))
                    && out_path.is_file()
                {
                    heal_permission_list_file(&out_path, &manifest_dir);
                }
            }
        }
    }
}

fn heal_permission_list_file(list_file: &Path, manifest_dir: &Path) {
    let Some(out_dir) = list_file.parent() else {
        return;
    };
    let Ok(content) = fs::read_to_string(list_file) else {
        return;
    };
    let Some(mut paths) = parse_json_string_array(&content) else {
        return;
    };
    let mut changed = false;
    for item in &mut paths {
        if Path::new(item.as_str()).exists() {
            continue;
        }
        let relocated = relocate_after_segment(item, "out", out_dir)
            .or_else(|| relocate_after_segment(item, "src-tauri", manifest_dir));
        if let Some(new_path) = relocated {
            *item = new_path.to_string_lossy().into_owned();
            changed = true;
        }
    }
    if changed {
        let encoded = encode_json_string_array(&paths);
        let _ = fs::write(list_file, encoded);
    }
}

fn relocate_after_segment(raw_path: &str, segment: &str, new_base: &Path) -> Option<PathBuf> {
    let win_needle = format!("\\{segment}\\");
    let unix_needle = format!("/{segment}/");
    let suffix = raw_path
        .rfind(&win_needle)
        .map(|idx| &raw_path[idx + win_needle.len()..])
        .or_else(|| {
            raw_path
                .rfind(&unix_needle)
                .map(|idx| &raw_path[idx + unix_needle.len()..])
        })?;
    let mut candidate = new_base.to_path_buf();
    for part in suffix.split(['\\', '/']).filter(|s| !s.is_empty()) {
        candidate.push(part);
    }
    if candidate.exists() {
        Some(fs::canonicalize(&candidate).unwrap_or(candidate))
    } else {
        None
    }
}

fn parse_json_string_array(raw: &str) -> Option<Vec<String>> {
    let trimmed = raw.trim();
    let inner = trimmed.strip_prefix('[')?.strip_suffix(']')?.trim();
    if inner.is_empty() {
        return Some(Vec::new());
    }
    let mut result = Vec::new();
    let mut chars = inner.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() || ch == ',' {
            chars.next();
            continue;
        }
        if ch != '"' {
            return None;
        }
        chars.next();
        let mut current = String::new();
        let mut closed = false;
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    closed = true;
                    break;
                }
                '\\' => {
                    let esc = chars.next()?;
                    match esc {
                        '"' | '\\' | '/' => current.push(esc),
                        'b' => current.push('\u{0008}'),
                        'f' => current.push('\u{000c}'),
                        'n' => current.push('\n'),
                        'r' => current.push('\r'),
                        't' => current.push('\t'),
                        'u' => {
                            let mut hex = String::with_capacity(4);
                            for _ in 0..4 {
                                hex.push(chars.next()?);
                            }
                            let code = u32::from_str_radix(&hex, 16).ok()?;
                            current.push(char::from_u32(code)?);
                        }
                        _ => return None,
                    }
                }
                other => current.push(other),
            }
        }
        if !closed {
            return None;
        }
        result.push(current);
    }
    Some(result)
}

fn encode_json_string_array(items: &[String]) -> String {
    let mut out = String::from("[");
    for (idx, item) in items.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        out.push('"');
        for ch in item.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c => out.push(c),
            }
        }
        out.push('"');
    }
    out.push(']');
    out
}

