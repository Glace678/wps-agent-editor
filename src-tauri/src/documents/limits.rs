//! Shared size limits for the documents layer (OOXML packages, XML parts and input
//! archives). Centralized here so each value lives in exactly one place; `converter`,
//! `word` and `presentation` all reference these constants instead of redefining them.

/// Maximum size of a single OOXML part (64 MiB).
pub const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;

/// Maximum total expanded (decompressed) size of an OOXML package (256 MiB).
pub const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;

/// Maximum size of a single XML part read into memory (16 MiB).
pub const MAX_XML_BYTES: usize = 16 * 1024 * 1024;

/// Maximum size of a document / OOXML archive accepted as input (100 MiB).
pub const MAX_DOCUMENT_INPUT_BYTES: u64 = 100 * 1024 * 1024;
