use std::{env, fs, path::Path};

#[tokio::main]
async fn main() {
    let mut args = env::args_os().skip(1);
    let source = args
        .next()
        .expect("usage: inspect_word_conversion <source.doc> <destination.docx>");
    let destination = args
        .next()
        .expect("usage: inspect_word_conversion <source.doc> <destination.docx>");
    let result =
        wps_agent_editor_lib::documents::converter::prepare_word_with_metadata(Path::new(&source))
            .await
            .expect("Word conversion failed");
    fs::write(&destination, &result.data).expect("cannot write converted document");
    println!(
        "converter={:?} converted_from_legacy={} bytes={} images={} tables={} underlines={}",
        result.converter,
        result.converted_from_legacy,
        result.data.len(),
        result.normalized_legacy_image_count,
        result.normalized_table_count,
        result.removed_underline_run_count,
    );
}
