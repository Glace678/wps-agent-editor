use std::{fs, io::Cursor, path::PathBuf};

fn main() {
    ensure_default_icons();
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
