//! Diagnostic probe for the BitTorrent engine.
//!
//! Adds a real `.torrent` to a throw-away librqbit session and reports, every half second,
//! what the engine is doing: state machine phase, verified bytes, bytes on disk and wall
//! clock timings per phase. DHT, trackers and listeners are disabled and the torrent is
//! always added paused, so it is safe to run against huge torrents.
//!
//! Usage:
//!   cargo run --example torrent_probe -- <torrent> <output-dir> [file,indices] [rounds]

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions, TorrentStatsState};

fn dir_bytes(path: &Path) -> u64 {
    let mut total = 0u64;
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            total += dir_bytes(&entry.path());
        } else {
            total += meta.len();
        }
    }
    total
}

fn gib(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0 * 1024.0)
}

fn describe(stats: &librqbit::TorrentStats) -> String {
    match &stats.state {
        TorrentStatsState::Initializing { paused } => format!("Initializing(paused={paused})"),
        TorrentStatsState::Live => "Live".to_string(),
        TorrentStatsState::Paused => "Paused".to_string(),
        TorrentStatsState::Error => format!("Error({:?})", stats.error),
    }
}


#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: torrent_probe <torrent> <output-dir> [file,indices] [rounds]");
        std::process::exit(2);
    }

    let torrent_path = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]);
    let live = std::env::var("PROBE_LIVE").is_ok();
    let is_magnet = torrent_path.to_string_lossy().starts_with("magnet:");
    let only_files: Option<Vec<usize>> = args.get(3).and_then(|raw| {
        let list: Vec<usize> = raw
            .split(',')
            .filter_map(|part| part.trim().parse().ok())
            .collect();
        (!list.is_empty()).then_some(list)
    });
    let rounds: usize = args.get(4).and_then(|r| r.parse().ok()).unwrap_or(1);

    let bytes = if is_magnet {
        Vec::new()
    } else {
        std::fs::read(&torrent_path)?
    };
    if is_magnet {
        println!("magnet   : {}", torrent_path.display());
    } else {
        let meta = librqbit::torrent_from_bytes(&bytes)?;
        println!(
            "torrent  : {} -> infohash {}",
            torrent_path.display(),
            meta.info_hash.as_string()
        );
    }
    println!(
        "output   : {} (currently {:.2} GiB on disk) · live={live}",
        output_dir.display(),
        gib(dir_bytes(&output_dir))
    );
    println!("only_files: {only_files:?} rounds: {rounds}\n");

    std::fs::create_dir_all(&output_dir)?;

    let session = Session::new_with_opts(
        output_dir.clone(),
        if live {
            SessionOptions {
                persistence: None,
                ..Default::default()
            }
        } else {
            SessionOptions {
                dht: None,
                persistence: None,
                listen: None,
                disable_trackers: true,
                disable_local_service_discovery: true,
                ..Default::default()
            }
        },
    )
    .await?;

    for round in 1..=rounds {
        let before = dir_bytes(&output_dir);
        let started = Instant::now();
        println!("--- round {round}: {:.2} GiB on disk before add ---", gib(before));

        let opts = AddTorrentOptions {
            paused: !live,
            output_folder: Some(output_dir.to_string_lossy().to_string()),
            overwrite: true,
            only_files: only_files.clone(),
            disable_trackers: !live,
            ..Default::default()
        };

        let worker = session.clone();
        let add = if is_magnet {
            AddTorrent::from_url(torrent_path.to_string_lossy().to_string())
        } else {
            AddTorrent::from_bytes(bytes.clone())
        };
        let mut add_fut = Box::pin(worker.add_torrent(add, Some(opts)));

        let mut ticker = tokio::time::interval(Duration::from_millis(500));
        let mut last_print = Instant::now();

        let handle = loop {
            tokio::select! {
                response = &mut add_fut => {
                    let handle = match response? {
                        librqbit::AddTorrentResponse::Added(_, handle) => handle,
                        librqbit::AddTorrentResponse::AlreadyManaged(_, handle) => handle,
                        librqbit::AddTorrentResponse::ListOnly(_) => {
                            return Err("unexpected list-only response".into())
                        }
                    };
                    println!("add_torrent returned after {:?}", started.elapsed());
                    break handle;
                }
                _ = ticker.tick() => {
                    let snapshot = session.with_torrents(|iter| {
                        iter.map(|(_, h)| {
                            let stats = h.stats();
                            (describe(&stats), stats.progress_bytes, stats.file_progress.iter().sum::<u64>())
                        }).next()
                    });
                    match snapshot {
                        Some((state, progress, file_progress)) => println!(
                            "  t+{:>6.2}s {state:<22} checked {:>7.2} GiB  files {:>7.2} GiB  disk {:>7.2} GiB",
                            last_print.elapsed().as_secs_f64(),
                            gib(progress),
                            gib(file_progress),
                            gib(dir_bytes(&output_dir)),
                        ),
                        None => println!(
                            "  t+{:>6.2}s (not in session yet)                       disk {:>7.2} GiB",
                            last_print.elapsed().as_secs_f64(),
                            gib(dir_bytes(&output_dir)),
                        ),
                    }
                    last_print = Instant::now();
                }
            }
        };

        // `add_torrent` only registers the torrent; the expensive part (initial hash
        // check + file allocation) keeps running in the background. Follow it to the end.
        let deadline = Instant::now() + Duration::from_secs(300);
        while Instant::now() < deadline {
            let stats = handle.stats();
            if !matches!(stats.state, TorrentStatsState::Initializing { .. }) {
                break;
            }
            println!(
                "  init t+{:>6.1}s {:<22} checked {:>7.2} GiB  disk {:>7.2} GiB",
                started.elapsed().as_secs_f64(),
                describe(&stats),
                gib(stats.progress_bytes),
                gib(dir_bytes(&output_dir)),
            );
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        let stats = handle.stats();
        println!(
            "round {round} settled: state={} total={:.2} GiB have={:.2} GiB after {:?}",
            describe(&stats),
            gib(stats.total_bytes),
            gib(stats.progress_bytes),
            started.elapsed()
        );
        println!(
            "disk after round {round}: {:.2} GiB (+{:.2} GiB)\n",
            gib(dir_bytes(&output_dir)),
            gib(dir_bytes(&output_dir).saturating_sub(before))
        );

        if live {
            // Watch the swarm for a while: "downloads never start" is what this checks.
            println!("--- live swarm watch (peers / speed / progress) ---");
            let watch = Instant::now();
            while watch.elapsed() < Duration::from_secs(90) {
                let stats = handle.stats();
                let (peers, speed) = stats
                    .live
                    .as_ref()
                    .map(|live| {
                        (
                            live.snapshot.peer_stats.live,
                            live.download_speed.as_bytes(),
                        )
                    })
                    .unwrap_or((0, 0));
                println!(
                    "  t+{:>5.0}s peers={peers:<4} speed={:>8.1} KiB/s  have {:>6.2} MiB  state={}",
                    watch.elapsed().as_secs_f64(),
                    speed as f64 / 1024.0,
                    stats.progress_bytes as f64 / (1024.0 * 1024.0),
                    describe(&stats),
                );
                if stats.progress_bytes > 4 * 1024 * 1024 && peers > 0 {
                    println!(
                        "DOWNLOADING OK: {} MiB in {:?} from {peers} peer(s)",
                        stats.progress_bytes / (1024 * 1024),
                        watch.elapsed()
                    );
                    break;
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }

    println!("done; leaving {} in place for inspection", output_dir.display());
    Ok(())
}
