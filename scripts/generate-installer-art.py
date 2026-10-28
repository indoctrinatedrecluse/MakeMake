"""Generate NSIS installer artwork from the short Moai video.

NSIS can only display bitmaps, so the shorter `public/splash-moai.mp4` clip is
sampled into the three images Tauri's NSIS bundler supports:

  * sidebarImage           164 x 314  (welcome / finish page canvas)
  * headerImage            150 x  57  (installer page header)
  * uninstallerHeaderImage 150 x  57  (uninstaller page header)

Run with:  python scripts/generate-installer-art.py
"""

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
VIDEO_CANDIDATES = [ROOT / "public" / "splash-moai.mp4", ROOT / "public" / "splash-moai-longer.mp4"]
OUT_DIR = ROOT / "src-tauri" / "installer"

TARGETS = [
    ("installer-sidebar.bmp", 164, 314, 0.45),
    ("installer-header.bmp", 150, 57, 0.30),
    ("uninstaller-header.bmp", 150, 57, 0.60),
]


def pick_video() -> Path:
    for candidate in VIDEO_CANDIDATES:
        if candidate.is_file():
            return candidate
    raise SystemExit("No Moai video found in public/ — cannot generate installer art.")


def grab_frame(video: Path, fraction: float) -> np.ndarray:
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise SystemExit(f"Cannot open {video}")

    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total > 1:
        capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, min(total - 1, int(total * fraction))))

    ok, frame = capture.read()
    if not ok or frame is None:
        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = capture.read()
    capture.release()

    if not ok or frame is None:
        raise SystemExit(f"Cannot decode a frame from {video}")
    return frame


def cover_resize(frame: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resize + center-crop so the frame fills the target without distortion."""
    src_h, src_w = frame.shape[:2]
    scale = max(width / src_w, height / src_h)
    new_w, new_h = max(width, int(round(src_w * scale))), max(height, int(round(src_h * scale)))
    resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

    x0 = (new_w - width) // 2
    y0 = (new_h - height) // 2
    return resized[y0 : y0 + height, x0 : x0 + width]


def grade(frame: np.ndarray) -> np.ndarray:
    """Push a cyan/obsidian cyberpunk grade with a soft vignette."""
    img = frame.astype(np.float32) / 255.0

    # Slight desaturation, then grade the shadows cyan and keep the lava gold.
    gray = img.mean(axis=2, keepdims=True)
    img = gray + (img - gray) * 1.15
    img[..., 0] = np.clip(img[..., 0] * 1.18, 0.0, 1.0)  # B
    img[..., 1] = np.clip(img[..., 1] * 1.06, 0.0, 1.0)  # G
    img[..., 2] = np.clip(img[..., 2] * 0.86, 0.0, 1.0)  # R

    img = np.clip(img * 0.82, 0.0, 1.0)

    height, width = img.shape[:2]
    ys = np.linspace(-1.0, 1.0, height)[:, None]
    xs = np.linspace(-1.0, 1.0, width)[None, :]
    vignette = np.clip(1.15 - 0.55 * (xs * xs + ys * ys), 0.25, 1.0)[..., None]
    img = np.clip(img * vignette, 0.0, 1.0)

    return (img * 255.0).astype(np.uint8)


def main() -> None:
    video = pick_video()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for name, width, height, fraction in TARGETS:
        frame = grab_frame(video, fraction)
        art = grade(cover_resize(frame, width, height))
        target = OUT_DIR / name
        if not cv2.imwrite(str(target), art):
            raise SystemExit(f"Cannot write {target}")
        print(f"wrote {target.relative_to(ROOT)} ({width}x{height}) from {video.name}")


if __name__ == "__main__":
    main()
