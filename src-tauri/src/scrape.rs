//! Tracker scrape (BEP-48 for HTTP, BEP-15 for UDP).
//!
//! librqbit deliberately does not expose swarm sizes: its `TorrentStats` only carries the
//! peers it is *connected* to (`live`, `seen`, `queued`, `connecting`, `dead`), and the crate
//! has no notion of seeds or leechers at all. That is fine for a transfer, but it is exactly
//! the number a user needs when a torrent sits at 0 B/s ("are there any seeds, or is my
//! client the only one looking?").
//!
//! So MakeMake asks the trackers directly, the way every other client does:
//!
//! * **HTTP(S)** — `GET <announce path with `announce` → `scrape`>?info_hash=<raw 20 bytes>`.
//!   The response is bencoded: `d5:filesd20:<hash>d8:completei<n>e10:incompletei<n>ee...ee`.
//! * **UDP (BEP-15)** — a connect packet, then a scrape packet for one info hash.
//!
//! Both paths are bounded by [`TRACKER_TIMEOUT`] and are only ever called from a background
//! task (see `TorrentEngine::request_swarm_refresh`), never from a UI-triggered command, so a
//! dead tracker can never make the window hang.
//!
//! Trackers report *overlapping* swarms, so the numbers are merged with `max` rather than a
//! sum: a torrent announced to three trackers that all see the same 40 seeds has 40 seeds,
//! not 120.

use std::sync::OnceLock;
use std::time::Duration;

/// How long one tracker gets to answer a scrape.
const TRACKER_TIMEOUT: Duration = Duration::from_secs(6);

/// Upper bound on trackers scraped per torrent (a huge announce list must not turn into a
/// hundred sockets).
const MAX_TRACKERS: usize = 12;

/// A scrape response is tiny; anything larger is a captive portal or garbage.
const MAX_HTTP_BODY: usize = 64 * 1024;

/// Swarm size as reported by the trackers that answered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SwarmCounts {
    /// Peers that already have the whole payload (`complete`).
    pub seeds: u64,
    /// Peers that are still downloading (`incomplete`).
    pub leechers: u64,
    /// How many trackers contributed to these numbers (0 = nothing answered).
    pub sources: u32,
}

impl SwarmCounts {
    /// Did at least one tracker answer?
    pub fn reported(&self) -> bool {
        self.sources > 0
    }

    /// Merge another tracker's answer. `max` keeps the estimate honest (see module docs).
    fn merge(&mut self, other: SwarmCounts) {
        self.seeds = self.seeds.max(other.seeds);
        self.leechers = self.leechers.max(other.leechers);
        self.sources = self.sources.saturating_add(1);
    }
}

/// Scrape every tracker of one torrent concurrently and merge the answers.
///
/// Never fails: a torrent whose trackers are unreachable or that is DHT-only simply reports
/// [`SwarmCounts::default`] (`sources == 0`), and the UI shows "unknown" instead of a lie.
pub async fn scrape(info_hash: &str, trackers: &[String]) -> SwarmCounts {
    let Some(hash) = decode_info_hash(info_hash) else {
        return SwarmCounts::default();
    };

    let mut answers = tokio::task::JoinSet::new();
    for tracker in trackers.iter().take(MAX_TRACKERS) {
        let tracker = tracker.trim();
        if let Some(url) = http_scrape_url(tracker, &hash) {
            answers.spawn(async move { scrape_http(&url, &hash).await });
        } else if let Some(target) = udp_target(tracker) {
            answers.spawn(async move { scrape_udp(&target, &hash).await });
        }
    }

    let mut counts = SwarmCounts::default();
    while let Some(joined) = answers.join_next().await {
        if let Ok(Some((seeds, leechers))) = joined {
            counts.merge(SwarmCounts {
                seeds,
                leechers,
                sources: 1,
            });
        }
    }
    counts
}


// ---------------------------------------------------------------------
// HTTP(S)
// ---------------------------------------------------------------------

fn http_client() -> Option<&'static reqwest::Client> {
    static CLIENT: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(TRACKER_TIMEOUT)
                .user_agent(concat!("MakeMake/", env!("CARGO_PKG_VERSION")))
                // Trackers are allowed to redirect; do not chase many hops though.
                .redirect(reqwest::redirect::Policy::limited(3))
                .build()
                .ok()
        })
        .as_ref()
}

async fn scrape_http(url: &str, hash: &[u8; 20]) -> Option<(u64, u64)> {
    let client = http_client()?;
    let response = tokio::time::timeout(TRACKER_TIMEOUT, client.get(url).send())
        .await
        .ok()?
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = tokio::time::timeout(TRACKER_TIMEOUT, response.bytes())
        .await
        .ok()?
        .ok()?;
    if body.len() > MAX_HTTP_BODY {
        return None;
    }
    parse_http_scrape(&body, hash)
}

/// Turn an announce URL into its scrape URL (`…/announce` → `…/scrape`), or `None` when the
/// URL is not HTTP(S) or does not follow the BEP-48 convention.
fn http_scrape_url(tracker: &str, hash: &[u8; 20]) -> Option<String> {
    let (scheme, rest) = tracker
        .strip_prefix("https://")
        .map(|rest| ("https", rest))
        .or_else(|| tracker.strip_prefix("http://").map(|rest| ("http", rest)))?;

    // The announce query string belongs to the announce request; a private tracker keeps its
    // passkey in the *path*, which is preserved by the split below.
    let rest = rest.split('#').next().unwrap_or(rest);
    let rest = rest.split('?').next().unwrap_or(rest);

    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    if authority.is_empty() {
        return None;
    }

    let mut parts: Vec<String> = path.split('/').map(|part| part.to_string()).collect();
    let last = parts.pop()?;
    let scrape = if last.is_empty() {
        // `http://tracker.example.com` or `…/`
        "scrape".to_string()
    } else {
        // Anything that is not an `announce` endpoint is not a BEP-48 tracker path.
        let suffix = last.strip_prefix("announce")?;
        format!("scrape{suffix}")
    };
    parts.push(scrape);

    let path = parts.join("/");
    Some(format!(
        "{scheme}://{authority}{path}?info_hash={}",
        percent_encode(hash)
    ))
}

/// Percent-encode raw info-hash bytes the way trackers expect (`%XX` for everything that is
/// not an unreserved URL character).
fn percent_encode(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 3);
    for &byte in bytes {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push('%');
            encoded.push_str(&format!("{byte:02X}"));
        }
    }
    encoded
}


// ---------------------------------------------------------------------
// UDP (BEP-15)
// ---------------------------------------------------------------------

/// `udp://host:port/announce` → `host:port`.
fn udp_target(tracker: &str) -> Option<String> {
    let rest = tracker.strip_prefix("udp://")?;
    let rest = rest.split('#').next().unwrap_or(rest);
    let rest = rest.split('?').next().unwrap_or(rest);
    let authority = rest.split('/').next().unwrap_or(rest).trim();
    if authority.is_empty() {
        return None;
    }
    Some(authority.to_string())
}

async fn scrape_udp(target: &str, hash: &[u8; 20]) -> Option<(u64, u64)> {
    let peer = tokio::net::lookup_host(target).await.ok()?.next()?;
    let bind = if peer.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let socket = tokio::net::UdpSocket::bind(bind).await.ok()?;
    socket.connect(peer).await.ok()?;

    // 1. connect
    let transaction = next_transaction_id();
    let request = connect_packet(transaction);
    tokio::time::timeout(TRACKER_TIMEOUT, socket.send(&request))
        .await
        .ok()?
        .ok()?;

    let mut buffer = [0u8; 2048];
    let read = tokio::time::timeout(TRACKER_TIMEOUT, socket.recv(&mut buffer))
        .await
        .ok()?
        .ok()?;
    let connection_id = parse_udp_connect(&buffer[..read], transaction)?;

    // 2. scrape
    let transaction = next_transaction_id();
    let request = scrape_packet(connection_id, transaction, hash);
    tokio::time::timeout(TRACKER_TIMEOUT, socket.send(&request))
        .await
        .ok()?
        .ok()?;

    let read = tokio::time::timeout(TRACKER_TIMEOUT, socket.recv(&mut buffer))
        .await
        .ok()?
        .ok()?;
    parse_udp_scrape(&buffer[..read], transaction)
}

const UDP_PROTOCOL_ID: u64 = 0x0000_0417_2710_1980;
const ACTION_CONNECT: u32 = 0;
const ACTION_SCRAPE: u32 = 2;

fn connect_packet(transaction_id: u32) -> [u8; 16] {
    let mut packet = [0u8; 16];
    packet[..8].copy_from_slice(&UDP_PROTOCOL_ID.to_be_bytes());
    packet[8..12].copy_from_slice(&ACTION_CONNECT.to_be_bytes());
    packet[12..].copy_from_slice(&transaction_id.to_be_bytes());
    packet
}

fn scrape_packet(connection_id: u64, transaction_id: u32, hash: &[u8; 20]) -> [u8; 36] {
    let mut packet = [0u8; 36];
    packet[..8].copy_from_slice(&connection_id.to_be_bytes());
    packet[8..12].copy_from_slice(&ACTION_SCRAPE.to_be_bytes());
    packet[12..16].copy_from_slice(&transaction_id.to_be_bytes());
    packet[16..].copy_from_slice(hash);
    packet
}

fn parse_udp_connect(response: &[u8], transaction_id: u32) -> Option<u64> {
    let action = u32::from_be_bytes(response.get(..4)?.try_into().ok()?);
    let echoed = u32::from_be_bytes(response.get(4..8)?.try_into().ok()?);
    if action != ACTION_CONNECT || echoed != transaction_id {
        return None;
    }
    Some(u64::from_be_bytes(response.get(8..16)?.try_into().ok()?))
}

fn parse_udp_scrape(response: &[u8], transaction_id: u32) -> Option<(u64, u64)> {
    let action = u32::from_be_bytes(response.get(..4)?.try_into().ok()?);
    let echoed = u32::from_be_bytes(response.get(4..8)?.try_into().ok()?);
    if action != ACTION_SCRAPE || echoed != transaction_id {
        return None;
    }
    // One 12-byte entry per requested info hash: complete, downloaded, incomplete.
    let seeds = u32::from_be_bytes(response.get(8..12)?.try_into().ok()?);
    let leechers = u32::from_be_bytes(response.get(16..20)?.try_into().ok()?);
    Some((seeds as u64, leechers as u64))
}

fn next_transaction_id() -> u32 {
    use std::sync::atomic::{AtomicU32, Ordering};

    static NEXT: AtomicU32 = AtomicU32::new(0x5f3a_91c7);
    let sequence = NEXT.fetch_add(0x9e37_79b9, Ordering::Relaxed);
    let clock = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.subsec_nanos())
        .unwrap_or(0);
    sequence ^ clock
}


// ---------------------------------------------------------------------
// Bencode (only what a scrape response needs)
// ---------------------------------------------------------------------

/// A parsed bencode value, borrowed from the response body.
#[derive(Debug, PartialEq)]
enum Ben<'a> {
    Int(i64),
    Bytes(&'a [u8]),
    List(Vec<Ben<'a>>),
    Dict(Vec<(&'a [u8], Ben<'a>)>),
}

impl<'a> Ben<'a> {
    fn get(&self, key: &str) -> Option<&Ben<'a>> {
        match self {
            Ben::Dict(entries) => entries
                .iter()
                .find(|(name, _)| *name == key.as_bytes())
                .map(|(_, value)| value),
            _ => None,
        }
    }

    fn as_int(&self) -> Option<u64> {
        match self {
            Ben::Int(value) if *value >= 0 => Some(*value as u64),
            _ => None,
        }
    }
}

/// Parse one bencode value, returning it and how many bytes it used.
fn parse_bencode(input: &[u8]) -> Option<(Ben<'_>, usize)> {
    match *input.first()? {
        b'i' => {
            let end = input.iter().position(|&byte| byte == b'e')?;
            let value = std::str::from_utf8(&input[1..end]).ok()?.parse().ok()?;
            Some((Ben::Int(value), end + 1))
        }
        b'l' => {
            let mut items = Vec::new();
            let mut offset = 1usize;
            while *input.get(offset)? != b'e' {
                let (value, used) = parse_bencode(input.get(offset..)?)?;
                items.push(value);
                offset += used;
            }
            Some((Ben::List(items), offset + 1))
        }
        b'd' => {
            let mut entries = Vec::new();
            let mut offset = 1usize;
            while *input.get(offset)? != b'e' {
                let (key, used) = parse_bencode(input.get(offset..)?)?;
                offset += used;
                let (value, used) = parse_bencode(input.get(offset..)?)?;
                offset += used;
                match key {
                    Ben::Bytes(key) => entries.push((key, value)),
                    _ => return None,
                }
            }
            Some((Ben::Dict(entries), offset + 1))
        }
        b'0'..=b'9' => {
            let colon = input.iter().position(|&byte| byte == b':')?;
            let length: usize = std::str::from_utf8(&input[..colon]).ok()?.parse().ok()?;
            let start = colon + 1;
            let end = start.checked_add(length)?;
            Some((Ben::Bytes(input.get(start..end)?), end))
        }
        _ => None,
    }
}

/// Pull `files -> <hash> -> {complete, incomplete}` out of a scrape body.
fn parse_http_scrape(body: &[u8], hash: &[u8; 20]) -> Option<(u64, u64)> {
    let (root, _) = parse_bencode(body)?;
    // A tracker may answer with `d14:failure reason…e` instead of any numbers.
    if root.get("failure reason").is_some() {
        return None;
    }
    let entry = match root.get("files")? {
        Ben::Dict(entries) => entries
            .iter()
            .find(|(key, _)| *key == hash)
            .map(|(_, value)| value)?,
        _ => return None,
    };
    let seeds = entry.get("complete").and_then(Ben::as_int)?;
    let leechers = entry.get("incomplete").and_then(Ben::as_int)?;
    Some((seeds, leechers))
}

fn decode_info_hash(info_hash: &str) -> Option<[u8; 20]> {
    let hex = info_hash.trim().as_bytes();
    if hex.len() != 40 {
        return None;
    }
    let mut bytes = [0u8; 20];
    for (index, slot) in bytes.iter_mut().enumerate() {
        let high = (hex[index * 2] as char).to_digit(16)?;
        let low = (hex[index * 2 + 1] as char).to_digit(16)?;
        *slot = (high * 16 + low) as u8;
    }
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HASH: [u8; 20] = [
        0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
        0x88, 0x99, 0xaa, 0xbb, 0xcc,
    ];
    const HASH_HEX: &str = "123456789abcdef0112233445566778899aabbcc";
    /// What `percent_encode` must produce for [`HASH`] (bytes that are ASCII alphanumerics
    /// stay literal: `0x33`='3', `0x44`='D', `0x55`='U', `0x66`='f', `0x77`='w').
    const HASH_ENCODED: &str = "%124Vx%9A%BC%DE%F0%11%223DUfw%88%99%AA%BB%CC";

    #[test]
    fn info_hash_hex_round_trips() {
        assert_eq!(decode_info_hash(HASH_HEX).unwrap(), HASH);
        // Uppercase hex is legal in a magnet link.
        assert_eq!(decode_info_hash(&HASH_HEX.to_uppercase()).unwrap(), HASH);
        assert!(decode_info_hash("nope").is_none());
        assert!(decode_info_hash(&"z".repeat(40)).is_none());
    }

    #[test]
    fn announce_urls_become_scrape_urls() {
        assert_eq!(
            http_scrape_url("https://tracker.example.org:8443/announce", &HASH).unwrap(),
            format!("https://tracker.example.org:8443/scrape?info_hash={HASH_ENCODED}")
        );
        // A tracker whose path ends in `/announce.php` keeps its suffix.
        assert_eq!(
            http_scrape_url("http://t.example/announce.php", &HASH).unwrap(),
            format!("http://t.example/scrape.php?info_hash={HASH_ENCODED}")
        );
        // The announce query string is not carried over to the scrape request.
        assert_eq!(
            http_scrape_url("https://t.example/a/b/announce?passkey=secret", &HASH).unwrap(),
            format!("https://t.example/a/b/scrape?info_hash={HASH_ENCODED}")
        );
        // Non-BEP-48 paths and other schemes are skipped, not guessed at.
        assert!(http_scrape_url("https://t.example/register", &HASH).is_none());
        assert!(http_scrape_url("udp://t.example:1337/announce", &HASH).is_none());
    }

    #[test]
    fn udp_targets_keep_only_the_authority() {
        assert_eq!(
            udp_target("udp://tracker.opentrackr.org:1337/announce").unwrap(),
            "tracker.opentrackr.org:1337"
        );
        assert_eq!(
            udp_target("udp://tracker.example:6969/announce?x=1").unwrap(),
            "tracker.example:6969"
        );
        assert!(udp_target("https://tracker.example/announce").is_none());
    }

    #[test]
    fn scrape_response_yields_seed_and_leech_counts() {
        let mut body = Vec::new();
        body.extend_from_slice(b"d5:filesd20:");
        body.extend_from_slice(&HASH);
        body.extend_from_slice(b"d8:completei42e10:downloadedi900e10:incompletei7eeee");

        assert_eq!(parse_http_scrape(&body, &HASH), Some((42, 7)));
        // A hash the tracker did not answer for is not in the response.
        assert_eq!(parse_http_scrape(&body, &[0u8; 20]), None);
    }

    #[test]
    fn tracker_failure_and_garbage_report_nothing() {
        let failure = b"d14:failure reason18:torrent not founde";
        assert_eq!(parse_http_scrape(failure, &HASH), None);
        assert_eq!(parse_http_scrape(b"<html>nope</html>", &HASH), None);
        assert_eq!(parse_http_scrape(b"d5:filesd20:", &HASH), None);
    }

    #[test]
    fn bencode_parser_handles_nesting() {
        let input = b"d1:ai1e1:bl1:xi2eee";
        let (value, used) = parse_bencode(input).unwrap();
        assert_eq!(used, input.len());
        assert_eq!(value.get("a").and_then(Ben::as_int), Some(1));
        match value.get("b") {
            Some(Ben::List(items)) => assert_eq!(items.len(), 2),
            other => panic!("expected a list, got {other:?}"),
        }
    }

    #[test]
    fn udp_packets_match_bep15() {
        let connect = connect_packet(0xdead_beef);
        assert_eq!(&connect[..8], &UDP_PROTOCOL_ID.to_be_bytes());
        assert_eq!(&connect[8..12], &0u32.to_be_bytes());
        assert_eq!(&connect[12..], &0xdead_beefu32.to_be_bytes());

        let scrape_request = scrape_packet(0x1122_3344_5566_7788, 7, &HASH);
        assert_eq!(&scrape_request[..8], &0x1122_3344_5566_7788u64.to_be_bytes());
        assert_eq!(&scrape_request[8..12], &ACTION_SCRAPE.to_be_bytes());
        assert_eq!(&scrape_request[12..16], &7u32.to_be_bytes());
        assert_eq!(&scrape_request[16..], &HASH);

        // The tracker echoes our transaction id, so a stale or spoofed answer is rejected.
        let mut response = Vec::new();
        response.extend_from_slice(&ACTION_CONNECT.to_be_bytes());
        response.extend_from_slice(&7u32.to_be_bytes());
        response.extend_from_slice(&99u64.to_be_bytes());
        assert_eq!(parse_udp_connect(&response, 7), Some(99));
        assert_eq!(parse_udp_connect(&response, 8), None);

        let mut scrape_response = Vec::new();
        scrape_response.extend_from_slice(&ACTION_SCRAPE.to_be_bytes());
        scrape_response.extend_from_slice(&11u32.to_be_bytes());
        scrape_response.extend_from_slice(&12u32.to_be_bytes());
        scrape_response.extend_from_slice(&500u32.to_be_bytes());
        scrape_response.extend_from_slice(&3u32.to_be_bytes());
        assert_eq!(parse_udp_scrape(&scrape_response, 11), Some((12, 3)));
        assert_eq!(parse_udp_scrape(&scrape_response, 12), None);
        assert_eq!(parse_udp_scrape(&scrape_response[..10], 11), None);
    }

    #[test]
    fn merging_takes_the_largest_swarm_and_counts_sources() {
        let mut merged = SwarmCounts::default();
        assert!(!merged.reported());

        merged.merge(SwarmCounts {
            seeds: 3,
            leechers: 90,
            sources: 1,
        });
        merged.merge(SwarmCounts {
            seeds: 8,
            leechers: 40,
            sources: 1,
        });

        assert_eq!(merged.seeds, 8);
        assert_eq!(merged.leechers, 90);
        assert_eq!(merged.sources, 2);
        assert!(merged.reported());
    }

    #[tokio::test]
    async fn unreachable_trackers_report_nothing_instead_of_failing() {
        // Port 9 is the discard port: nothing answers, and a closed local port errors out fast.
        let counts = scrape(
            HASH_HEX,
            &["udp://127.0.0.1:9/announce".to_string()],
        )
        .await;
        assert_eq!(counts, SwarmCounts::default());
    }
}
