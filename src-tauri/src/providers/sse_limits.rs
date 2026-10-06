//! Shared bounds for provider Server-Sent-Events streams (wps_06 A1/N-5).
//!
//! * [`bounded_sse_bytes`] enforces a byte budget on an event frame while the
//!   bytes are still streaming — before the eventsource parser accumulates
//!   them — so a frame without a terminating blank line cannot grow without
//!   bound.
//! * [`SSE_IDLE_TIMEOUT`] bounds the gap between chunks (a stalled
//!   connection), replacing the shared client's old *total* timeout that
//!   killed legitimate long agent runs.

use bytes::Bytes;
use futures_util::{future, stream::StreamExt, Stream};
use reqwest::Response;
use std::time::Duration;

/// Max bytes buffered while assembling ONE SSE event frame (from its first
/// field line to the terminating blank line).
pub(crate) const MAX_SSE_FRAME_BYTES: usize = 2 * 1024 * 1024;

/// No data for this long means the connection stalled. A long agent run still
/// emits chunks frequently; only the silence between them is bounded.
pub(crate) const SSE_IDLE_TIMEOUT: Duration = Duration::from_secs(120);

/// Waiting for the response headers themselves (connect succeeded but the
/// server never sent a status line).
pub(crate) const RESPONSE_HEADERS_TIMEOUT: Duration = Duration::from_secs(30);

/// Wrap a response body so reading stops as soon as one event frame exceeds
/// [`MAX_SSE_FRAME_BYTES`]. The returned stream plugs directly into
/// `.eventsource()`.
pub(crate) fn bounded_sse_bytes(
    response: Response,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> {
    response
        .bytes_stream()
        .scan(FrameBudget::default(), |budget, chunk| {
            let item = match chunk {
                Ok(bytes) => match budget.note_bytes(&bytes) {
                    Ok(()) => Some(Ok(bytes)),
                    Err(error) => Some(Err(error)),
                },
                Err(error) => Some(Err(std::io::Error::other(error))),
            };
            future::ready(item)
        })
}

/// Rolling counter of bytes in the current event frame.
#[derive(Debug, Default)]
struct FrameBudget {
    /// Bytes accumulated in the frame since its last blank-line terminator.
    frame: usize,
    /// Content bytes on the line currently being read.
    line: usize,
    /// A lone `\r` at the start of the current line (CRLF candidate).
    lone_cr: bool,
}

impl FrameBudget {
    fn note_bytes(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        for &byte in bytes {
            match byte {
                b'\n' => {
                    if self.line == 0 {
                        // Empty line: blank-line terminator, the next event starts.
                        self.frame = 0;
                    } else {
                        self.frame = self.frame.saturating_add(self.line + 1);
                    }
                    self.line = 0;
                    self.lone_cr = false;
                    if self.frame > MAX_SSE_FRAME_BYTES {
                        return Err(frame_too_large());
                    }
                }
                b'\r' if self.line == 0 && !self.lone_cr => self.lone_cr = true,
                _ => {
                    if self.lone_cr {
                        // The \r was not followed by \n: count it as content.
                        self.line += 1;
                        self.lone_cr = false;
                    }
                    self.line += 1;
                    if self.frame.saturating_add(self.line) > MAX_SSE_FRAME_BYTES {
                        return Err(frame_too_large());
                    }
                }
            }
        }
        Ok(())
    }
}

fn frame_too_large() -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("SSE event frame exceeded the {MAX_SSE_FRAME_BYTES}-byte limit"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget_for(bytes: &[u8]) -> std::io::Result<FrameBudget> {
        let mut budget = FrameBudget::default();
        budget.note_bytes(bytes)?;
        Ok(budget)
    }

    #[test]
    fn blank_lines_reset_the_frame_budget() {
        let budget = budget_for(b"data: hello\n\ndata: world\n").unwrap();
        assert_eq!(budget.frame, "data: world\n".len());
    }

    #[test]
    fn crlf_blank_lines_are_recognised() {
        let budget = budget_for(b"data: a\r\n\r\ndata: b\r\n").unwrap();
        assert_eq!(budget.frame, "data: b\r\n".len());
    }

    #[test]
    fn unterminated_oversized_frame_is_rejected() {
        let bytes = vec![b'x'; MAX_SSE_FRAME_BYTES + 1];
        assert_eq!(
            budget_for(&bytes).unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
    }

    #[test]
    fn multiple_lines_accumulate_until_the_blank_terminator() {
        let err = budget_for(b"data: x\ndata: y\n\n").unwrap();
        assert_eq!(err.frame, 0, "blank line reset after the event");
        let growing = budget_for(b"data: x\ndata: y\n").unwrap();
        assert_eq!(growing.frame, "data: x\ndata: y\n".len());
    }
}
