"""User-triggered image QR login fallback for xiaohongshu-cli."""

import os
import sys
import tempfile
from pathlib import Path

import qrcode
from xhs_cli import qr_login


QR_IMAGE_PATH = Path(tempfile.gettempdir()) / "MintAtelier-XhsLogin.svg"


def save_qr_image(data: str, *, open_image: bool = True) -> Path:
    """Render the temporary login URL as a dependency-free, pixel-perfect SVG."""
    qr = qrcode.QRCode(version=None, error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    size = len(matrix)
    modules = "".join(
        f'<rect x="{x}" y="{y}" width="1" height="1"/>'
        for y, row in enumerate(matrix)
        for x, enabled in enumerate(row)
        if enabled
    )
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" '
        'width="900" height="900" shape-rendering="crispEdges">'
        f'<rect width="{size}" height="{size}" fill="white"/>'
        f'<g fill="black">{modules}</g></svg>'
    )
    QR_IMAGE_PATH.write_text(svg, encoding="utf-8")

    print(f"\nA scannable QR image was saved to:\n{QR_IMAGE_PATH}")
    if open_image:
        try:
            os.startfile(QR_IMAGE_PATH)  # type: ignore[attr-defined]
            print("The QR image has been opened in your default image viewer.")
        except OSError as exc:
            print(f"Could not open the image automatically: {exc}", file=sys.stderr)
    return QR_IMAGE_PATH


def main() -> int:
    # Replace terminal half-block rendering, which can be distorted by Windows
    # console fonts and line spacing, with a normal PNG opened by the OS.
    qr_login._display_qr_in_terminal = lambda data: bool(save_qr_image(data))
    try:
        qr_login.qrcode_login(prefer_browser_assisted=False)
    except KeyboardInterrupt:
        print("\nLogin cancelled by user.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"\nQR login failed: {exc}", file=sys.stderr)
        return 1

    else:
        print("\nQR login completed and the session was saved.")
        return 0
    finally:
        try:
            QR_IMAGE_PATH.unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())
