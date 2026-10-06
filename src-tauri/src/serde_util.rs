//! Helpers for `serde_json::Value` data crossing the Tauri IPC boundary.

use serde_json::Value;

/// Largest integer representable exactly in an IEEE-754 double: 2^53 - 1.
pub const MAX_SAFE_JS_INTEGER: i128 = (1i128 << 53) - 1;

/// Recursively rewrite integers outside the JavaScript safe-integer range into
/// decimal strings (wps_03 D10). `serde_json` carries full i64/u64 precision,
/// but once a value travels over IPC it lands in an IEEE-754 double and any
/// magnitude above 2^53 is silently corrupted. The digits survive unchanged as
/// a string, and the constraint is declared on the generated `JsonValue` type.
///
/// Floats are left untouched (they are doubles by nature) and string/null/bool
/// values pass through unchanged.
pub fn stringify_unsafe_ints(value: Value) -> Value {
    match value {
        Value::Number(ref number) if number.is_i64() || number.is_u64() => {
            let integer = number
                .as_i64()
                .map(|value| value as i128)
                .or_else(|| number.as_u64().map(|value| value as i128));
            if let Some(integer) = integer {
                if integer > MAX_SAFE_JS_INTEGER || integer < -MAX_SAFE_JS_INTEGER {
                    return Value::String(number.to_string());
                }
            }
            value
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(stringify_unsafe_ints)
                .collect::<Vec<_>>(),
        ),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(key, item)| (key, stringify_unsafe_ints(item)))
                .collect(),
        ),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn converts_only_out_of_range_integers() {
        let input = json!({
            "safe": 42,
            "edgePositive": MAX_SAFE_JS_INTEGER as u64,
            "edgeNegative": -(MAX_SAFE_JS_INTEGER as i64),
            "tooBig": 9_007_199_254_740_993u64,
            "deep": [i64::MIN, { "u64max": u64::MAX }],
            "float": 1.5e100,
            "text": "9007199254740993",
        });
        let output = stringify_unsafe_ints(input);
        assert_eq!(output["safe"], json!(42));
        assert_eq!(output["edgePositive"], json!(MAX_SAFE_JS_INTEGER as u64));
        assert_eq!(output["edgeNegative"], json!(-(MAX_SAFE_JS_INTEGER as i64)));
        assert_eq!(output["tooBig"], json!("9007199254740993"));
        assert_eq!(output["deep"][0], json!(i64::MIN.to_string()));
        assert_eq!(output["deep"][1]["u64max"], json!(u64::MAX.to_string()));
        assert_eq!(output["float"], json!(1.5e100));
        assert_eq!(output["text"], json!("9007199254740993"));
    }

    #[test]
    fn leaves_null_and_bool_untouched() {
        let input = json!([null, true, false]);
        assert_eq!(stringify_unsafe_ints(input.clone()), input);
    }
}
