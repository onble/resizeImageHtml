#!/usr/bin/env python3
"""One-request image worker: JSON line + original bytes in, JSON line + image out.

The bundled resize CLI supplies the RGBA/LANCZOS pipeline. The local Node server
owns paths and writes; this worker has no user-controlled filesystem access.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
from pathlib import Path
import queue
import sys
import tempfile
import threading
import warnings

sys.dont_write_bytecode = True

import resize_image as original_resize

MAX_INPUT_BYTES = 80 * 1024 * 1024
MAX_INPUT_PIXELS = 100_000_000
MAX_OUTPUT_PIXELS = 32 * 1024 * 1024
MAX_SIDE = 16384
PNG_TIMEOUT_SECONDS = 30
MAX_PLAN_BYTES = 1024 * 1024


class ImageRequestError(ValueError):
    """Stable, user-presentable error for the Node/i18n boundary."""


def load_image_module():
    if sys.version_info < (3, 10):
        raise ImageRequestError("Python 3.10 or later is required")
    try:
        from PIL import Image
    except ImportError as exc:
        raise ImageRequestError("Pillow is required for image processing") from exc
    Image.MAX_IMAGE_PIXELS = MAX_INPUT_PIXELS
    return Image


def resize_source_info():
    directory = Path(__file__).resolve().parent
    manifest = json.loads((directory / "resize-source.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256((directory / "resize_image.py").read_bytes()).hexdigest()
    if digest != manifest["sha256"]:
        raise ImageRequestError("Bundled resize source failed verification")
    defaults = original_resize.build_parser().parse_args([])
    return {"sourceSha256": digest, "defaults": {
        "mode": "height", "height": defaults.size,
        "palette": defaults.palette, "square": defaults.square, "format": "png",
        "resample": "LANCZOS",
    }}


def validate_options(options):
    if not isinstance(options, dict):
        raise ImageRequestError("Invalid image options")
    for name in ("allowUpscale", "pngOptimize", "palette"):
        if name in options and not isinstance(options[name], bool):
            raise ImageRequestError("Invalid image options")
    format_name = options.get("format", "png")
    if not isinstance(format_name, str) or format_name not in {"png", "jpeg", "webp"}:
        raise ImageRequestError("Unsupported output format")
    return format_name


def processing_info(options):
    return {"engine": "pillow", "resample": "LANCZOS",
            "palette": options.get("format", "png") == "png" and options.get("palette", False)}


def resize_rgba(image, target, resample, *, box=None):
    """Python-only extensions use the same RGBA then resize steps as the original script."""
    return image.convert("RGBA").resize(target, resample, box=box)


def positive(value):
    try:
        if isinstance(value, bool):
            raise ValueError
        number = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ImageRequestError("Dimensions and percentage must be positive finite numbers") from exc
    if not math.isfinite(number) or number <= 0:
        raise ImageRequestError("Dimensions and percentage must be positive finite numbers")
    return number


def dimension(value):
    number = positive(value)
    if not number.is_integer():
        raise ImageRequestError("Pixel dimensions must be integers")
    if number > MAX_SIDE:
        raise ImageRequestError("Output dimensions exceed the safety limit")
    return int(number)


def geometry(width, height, options):
    mode = options.get("mode")
    allow_upscale = options.get("allowUpscale", False)
    scale = 1.0
    if mode == "height":
        h = dimension(options.get("height"))
        w = max(1, round(width * h / height))
    elif mode == "width":
        w = dimension(options.get("width"))
        h = max(1, round(height * w / width))
    elif mode == "percent":
        scale = positive(options.get("percent")) / 100
        if not math.isfinite(width * scale) or not math.isfinite(height * scale):
            raise ImageRequestError("Output dimensions exceed the safety limit")
        w, h = max(1, round(width * scale)), max(1, round(height * scale))
    elif mode == "exact":
        w, h = dimension(options.get("width")), dimension(options.get("height"))
    elif mode == "fit":
        scale = min(dimension(options.get("width")) / width, dimension(options.get("height")) / height)
        if not allow_upscale:
            scale = min(1, scale)
        w, h = max(1, round(width * scale)), max(1, round(height * scale))
    else:
        raise ImageRequestError("Unknown resize mode")
    if w > MAX_SIDE or h > MAX_SIDE or w * h > MAX_OUTPUT_PIXELS:
        raise ImageRequestError("Output dimensions exceed the safety limit")

    draw_width, draw_height = w, h
    fit = options.get("fit", "stretch")
    if mode == "exact":
        if not isinstance(fit, str) or fit not in {"stretch", "contain", "cover"}:
            raise ImageRequestError("Unknown resize fit")
        if fit != "stretch":
            scale = (max if fit == "cover" else min)(w / width, h / height)
            draw_width, draw_height = width * scale, height * scale
    if not allow_upscale and (draw_width > width + 0.001 or draw_height > height + 0.001):
        raise ImageRequestError("Target requires upscaling; enable Allow upscaling or reduce dimensions")
    return {"width": w, "height": h, "drawWidth": draw_width, "drawHeight": draw_height}


def render(image, options, image_module):
    layout = geometry(*image.size, options)
    target = (layout["width"], layout["height"])
    resample = image_module.Resampling.LANCZOS
    fit = options.get("fit", "stretch")
    if options.get("mode") != "exact" or fit == "stretch":
        return resize_rgba(image, target, resample), layout
    if fit == "contain":
        resized_size = (max(1, round(layout["drawWidth"])), max(1, round(layout["drawHeight"])))
        resized = resize_rgba(image, resized_size, resample)
        result = image_module.new("RGBA", target, (0, 0, 0, 0))
        # No alpha mask: copying the RGBA pixels preserves partial alpha exactly.
        result.paste(resized, ((target[0] - resized_size[0]) // 2, (target[1] - resized_size[1]) // 2))
        return result, layout
    # Crop in source coordinates, avoiding a potentially enormous intermediate
    # bitmap for very wide/tall inputs while keeping the crop centered.
    scale = max(target[0] / image.width, target[1] / image.height)
    crop_width, crop_height = target[0] / scale, target[1] / scale
    left, top = (image.width - crop_width) / 2, (image.height - crop_height) / 2
    box = (left, top, min(image.width, left + crop_width), min(image.height, top + crop_height))
    return resize_rgba(image, target, resample, box=box), layout


def save_bytes(image, format_name, **settings):
    stream = io.BytesIO()
    image.save(stream, format=format_name, **settings)
    return stream.getvalue()


def original_square_for(original_size, layout, options):
    """Return the original CLI's square argument when it expresses this layout."""
    width, height = original_size
    target = (layout["width"], layout["height"])
    if options.get("mode") == "exact" and options.get("fit", "stretch") != "stretch":
        if (layout["drawWidth"], layout["drawHeight"]) != target:
            return None
    if options.get("mode") == "exact" and options.get("fit", "stretch") == "stretch" and target[0] == target[1]:
        return True
    if max(1, round(width * target[1] / height)) == target[0]:
        return False
    return None


def run_original_png(data, layout, options, image_module, square, timeout_seconds=PNG_TIMEOUT_SECONDS):
    result_queue = queue.Queue(maxsize=1)

    def run():
        try:
            # Node owns a per-request TEMP root and removes it after process exit
            # as well. This also cleans files if timeout/cancellation interrupts
            # the daemon while the original Pillow implementation is saving.
            with tempfile.TemporaryDirectory(prefix="resize-image-") as directory:
                source, destination = Path(directory) / "source", Path(directory) / "result.png"
                source.write_bytes(data)
                resample = image_module.Resampling.LANCZOS
                original_resize.resize_png(source, destination, layout["height"], resample, image_module,
                                options.get("palette", False), square)
                candidate = destination.read_bytes()
            # Derive byte savings without running the resize algorithm twice.
            # Keep the original PNG bytes even if its encoding is not smaller.
            with image_module.open(io.BytesIO(candidate)) as decoded:
                decoded.load()
                if decoded.size != (layout["width"], layout["height"]):
                    raise ValueError("Unexpected original resize dimensions")
                baseline = save_bytes(decoded, "PNG")
            result_queue.put((candidate, {
                "status": "optimized" if len(candidate) < len(baseline) else "original",
                "originalBytes": len(baseline), "optimizedBytes": len(candidate),
                "savedBytes": max(0, len(baseline) - len(candidate)),
            }))
        except Exception:
            result_queue.put((None, {"status": "failed"}))

    threading.Thread(target=run, daemon=True).start()
    try:
        return result_queue.get(timeout=timeout_seconds)
    except queue.Empty:
        return None, {"status": "timed-out"}


def optimize_png(image, baseline, image_module, timeout_seconds=PNG_TIMEOUT_SECONDS):
    result_queue = queue.Queue(maxsize=1)

    def optimize():
        try:
            candidate = save_bytes(image, "PNG", optimize=True, compress_level=9)
            if len(candidate) >= len(baseline):
                result_queue.put(("unchanged", baseline))
                return
            with image_module.open(io.BytesIO(candidate)) as decoded:
                decoded.load()
                if decoded.size != image.size or decoded.convert("RGBA").tobytes() != image.convert("RGBA").tobytes():
                    result_queue.put(("failed", baseline))
                    return
            result_queue.put(("optimized", candidate))
        except Exception:
            result_queue.put(("failed", baseline))

    # Each worker process handles exactly one image and exits after its reply.
    # A daemon thread allows timeout/cancellation to release the entire process;
    # it never creates a child process that could outlive Node's cancellation.
    thread = threading.Thread(target=optimize, daemon=True)
    thread.start()
    try:
        status, encoded = result_queue.get(timeout=timeout_seconds)
    except queue.Empty:
        status, encoded = "timed-out", baseline
    return encoded, {
        "status": status,
        "originalBytes": len(baseline),
        "optimizedBytes": len(encoded),
        "savedBytes": len(baseline) - len(encoded),
    }


def process_image(data, options):
    format_name = validate_options(options)
    quality = 95
    if format_name != "png":
        value = positive(options.get("quality", 0.95))
        if value < 0.01 or value > 1:
            raise ImageRequestError("Encoding quality must be between 1 and 100")
        quality = max(1, round(value * 100))
    if not data:
        raise ImageRequestError("Image data is empty")
    if len(data) > MAX_INPUT_BYTES:
        raise ImageRequestError("Input image exceeds 80 MB")

    image_module = load_image_module()
    encoded = None
    original_result = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", image_module.DecompressionBombWarning)
            with image_module.open(io.BytesIO(data)) as image:
                if image.format not in {"PNG", "JPEG", "WEBP", "BMP"}:
                    raise ImageRequestError("Unsupported input image format")
                if image.width * image.height > MAX_INPUT_PIXELS:
                    raise ImageRequestError("Input image exceeds 100 million pixels")
                original_size = image.size
                # Validate before decoding a potentially large input.
                layout = geometry(*original_size, options)
                square = original_square_for(original_size, layout, options)
                if format_name == "png" and options.get("pngOptimize", True) and square is not None:
                    encoded, original_result = run_original_png(data, layout, options, image_module, square)
                if encoded is None:
                    image.load()
                    resized, layout = render(image, options, image_module)
    except ImageRequestError:
        raise
    except (image_module.DecompressionBombWarning, image_module.DecompressionBombError) as exc:
        raise ImageRequestError("Input image exceeds 100 million pixels") from exc
    except Exception as exc:
        raise ImageRequestError("Cannot decode input image") from exc

    metadata = {
        "layout": {"width": layout["width"], "height": layout["height"]},
        "original": {"width": original_size[0], "height": original_size[1]},
        "format": format_name,
        "processing": processing_info(options),
    }
    if encoded is not None:
        metadata["optimization"] = original_result
        if len(encoded) > MAX_INPUT_BYTES:
            raise ImageRequestError("Output image exceeds 80 MB")
        return metadata, encoded
    try:
        if format_name == "png":
            if options.get("palette", False):
                resized = resized.convert("P", palette=image_module.Palette.ADAPTIVE, colors=256)
            encoded = save_bytes(resized, "PNG")
            if original_result is not None:
                metadata["optimization"] = {**original_result, "originalBytes": len(encoded),
                                            "optimizedBytes": len(encoded), "savedBytes": 0}
            elif options.get("pngOptimize", True):
                encoded, metadata["optimization"] = optimize_png(resized, encoded, image_module)
        elif format_name == "jpeg":
            white = image_module.new("RGB", resized.size, (255, 255, 255))
            white.paste(resized, mask=resized.getchannel("A"))
            encoded = save_bytes(white, "JPEG", quality=quality, optimize=True)
        else:
            encoded = save_bytes(resized, "WEBP", quality=quality)
    except Exception as exc:
        raise ImageRequestError("Cannot encode output image") from exc
    if len(encoded) > MAX_INPUT_BYTES:
        raise ImageRequestError("Output image exceeds 80 MB")
    return metadata, encoded


def plan_images(request):
    if not isinstance(request, dict) or not isinstance(request.get("images"), list) or len(request["images"]) > 10000:
        raise ImageRequestError("Invalid image plan")
    options = request.get("options")
    validate_options(options)
    items = []
    for source in request["images"]:
        item = {"id": source.get("id") if isinstance(source, dict) else None}
        try:
            if not isinstance(source, dict):
                raise ImageRequestError("Invalid source image dimensions")
            try:
                width, height = positive(source.get("width")), positive(source.get("height"))
            except ImageRequestError as exc:
                raise ImageRequestError("Invalid source image dimensions") from exc
            if not width.is_integer() or not height.is_integer():
                raise ImageRequestError("Invalid source image dimensions")
            if width * height > MAX_INPUT_PIXELS:
                raise ImageRequestError("Input image exceeds 100 million pixels")
            layout = geometry(int(width), int(height), options)
            item["layout"] = {"width": layout["width"], "height": layout["height"]}
        except ImageRequestError as exc:
            item["error"] = str(exc)
        items.append(item)
    return {"items": items, "processing": processing_info(options)}


def parse_json(data):
    def reject_constant(_):
        raise ValueError
    try:
        return json.loads(data.decode("utf-8"), parse_constant=reject_constant)
    except (ValueError, UnicodeError) as exc:
        raise ImageRequestError("Invalid image options") from exc


def main():
    try:
        if sys.argv[1:] == ["--check"]:
            image_module = load_image_module()
            print(json.dumps({"python": sys.version.split()[0], "pillow": image_module.__version__, "executable": sys.executable,
                              **resize_source_info()}))
            return 0
        if sys.argv[1:] == ["--plan"]:
            data = sys.stdin.buffer.read(MAX_PLAN_BYTES + 1)
            if len(data) > MAX_PLAN_BYTES:
                raise ImageRequestError("Invalid image plan")
            print(json.dumps(plan_images(parse_json(data)), separators=(",", ":")))
            return 0
        if len(sys.argv) != 1:
            raise ImageRequestError("Invalid image worker arguments")
        line = sys.stdin.buffer.readline(16 * 1024 + 1)
        if len(line) > 16 * 1024 or not line.endswith(b"\n"):
            raise ImageRequestError("Invalid image options")
        options = parse_json(line)
        data = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        metadata, encoded = process_image(data, options)
        sys.stdout.buffer.write(json.dumps(metadata, separators=(",", ":")).encode("utf-8") + b"\n")
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()
        return 0
    except ImageRequestError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception:
        print("Image processing failed", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
