use crate::error::{AppError, AppResult};
use serde::{de::DeserializeOwned, Serialize};

const MAGIC: &[u8; 4] = b"WAE1";
const HEADER_BYTES: usize = 8;
const MAX_METADATA_BYTES: usize = 1024 * 1024;

pub fn encode<T: Serialize>(metadata: &T, payload: &[u8]) -> AppResult<Vec<u8>> {
    let metadata = serde_json::to_vec(metadata)?;
    if metadata.len() > MAX_METADATA_BYTES {
        return Err(AppError::new(
            "invalid-binary",
            "WAE1 metadata exceeds the 1 MiB limit",
        ));
    }
    let metadata_len = u32::try_from(metadata.len())
        .map_err(|_| AppError::new("invalid-binary", "WAE1 metadata length is invalid"))?;
    let capacity = HEADER_BYTES
        .checked_add(metadata.len())
        .and_then(|size| size.checked_add(payload.len()))
        .ok_or_else(|| AppError::new("invalid-binary", "WAE1 envelope is too large"))?;
    let mut output = Vec::with_capacity(capacity);
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&metadata_len.to_le_bytes());
    output.extend_from_slice(&metadata);
    output.extend_from_slice(payload);
    Ok(output)
}

pub fn decode<T: DeserializeOwned>(data: &[u8], max_payload_bytes: usize) -> AppResult<(T, &[u8])> {
    if data.len() < HEADER_BYTES || &data[..MAGIC.len()] != MAGIC {
        return Err(AppError::new(
            "invalid-binary",
            "Binary IPC payload is not a WAE1 envelope",
        ));
    }
    let metadata_len = u32::from_le_bytes(
        data[4..8]
            .try_into()
            .map_err(|_| AppError::new("invalid-binary", "WAE1 header is truncated"))?,
    ) as usize;
    if metadata_len > MAX_METADATA_BYTES {
        return Err(AppError::new(
            "invalid-binary",
            "WAE1 metadata exceeds the 1 MiB limit",
        ));
    }
    let payload_offset = HEADER_BYTES
        .checked_add(metadata_len)
        .filter(|offset| *offset <= data.len())
        .ok_or_else(|| AppError::new("invalid-binary", "WAE1 metadata is truncated"))?;
    let payload = &data[payload_offset..];
    if payload.len() > max_payload_bytes {
        return Err(AppError::new(
            "file-too-large",
            format!("WAE1 payload exceeds the {max_payload_bytes} byte limit"),
        ));
    }
    let metadata = serde_json::from_slice(&data[HEADER_BYTES..payload_offset])?;
    Ok((metadata, payload))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Deserialize, PartialEq, Serialize)]
    struct Metadata {
        action: String,
        index: usize,
    }

    #[test]
    fn round_trips_metadata_and_raw_payload() {
        let metadata = Metadata {
            action: "edit".into(),
            index: 4,
        };
        let bytes = encode(&metadata, &[0, 1, 254, 255]).unwrap();
        let (decoded, payload) = decode::<Metadata>(&bytes, 4).unwrap();
        assert_eq!(decoded, metadata);
        assert_eq!(payload, [0, 1, 254, 255]);
    }

    #[test]
    fn rejects_bad_magic_truncation_and_payload_limit() {
        assert!(decode::<Metadata>(b"JSON", 10).is_err());
        assert!(decode::<Metadata>(b"WAE1\xff\xff\xff\x7f{}", 10).is_err());
        let bytes = encode(
            &Metadata {
                action: "edit".into(),
                index: 0,
            },
            &[1, 2],
        )
        .unwrap();
        assert!(decode::<Metadata>(&bytes, 1).is_err());
    }
}
